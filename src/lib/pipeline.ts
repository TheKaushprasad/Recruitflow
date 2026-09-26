import { errorMessage } from "./errors";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleFor } from "./google/auth";
import { listResponses, type RawResponse } from "./google/forms";
import { readResponseRows } from "./google/sheets";
import { scoreCandidate } from "./scoring";
import type { Candidate, FormQuestion, Job } from "./types";

// Background work for one job: pull new responses, then score what's pending.
// Runs with the service-role client, so every query filters by recruiter/job explicitly.

const NAME_RE = /(full\s*)?name/i;
const EMAIL_RE = /e-?mail/i;
const RESUME_RE = /resume|\bcv\b|curriculum/i;
const PORTFOLIO_RE = /portfolio|personal (web)?site|website|behance|dribbble/i;
const GITHUB_RE = /github/i;

function mapCandidateFields(r: RawResponse, roles: FormQuestion[]) {
  const byRole = (role: FormQuestion["role"], re: RegExp, not?: RegExp) => {
    const q = roles.find((x) => x.role === role);
    const hit = q
      ? r.answers.find((a) => a.question === q.title)
      : r.answers.find((a) => re.test(a.question) && !(not && not.test(a.question)));
    return hit?.answer?.trim() || null;
  };
  const email = r.email ?? byRole("email", EMAIL_RE);
  return {
    name: byRole("name", NAME_RE, /company|job|github|user ?name|file/i) ?? email ?? "Unnamed applicant",
    email: email && /\S+@\S+\.\S+/.test(email) ? email : null,
    resume_url: byRole("resume", RESUME_RE),
    portfolio_url: byRole("portfolio", PORTFOLIO_RE, GITHUB_RE),
    github_url: byRole("github", GITHUB_RE),
  };
}

export async function syncJob(db: SupabaseClient, job: Job) {
  try {
    const { auth } = await googleFor(job.recruiter_id);
    let responses: RawResponse[] = [];
    if (job.form_source === "built" && job.google_form_id) {
      responses = await listResponses(auth, job.google_form_id);
    } else if (job.form_source === "linked" && job.sheet_id) {
      responses = await readResponseRows(auth, job.sheet_id, job.sheet_range ?? "A:ZZ");
    } else {
      return { added: 0 };
    }

    const { data: qs } = await db.from("form_questions").select("*").eq("job_id", job.id);
    const rows = responses.map((r) => ({
      recruiter_id: job.recruiter_id,
      job_id: job.id,
      external_id: r.externalId,
      answers: r.answers,
      submitted_at: r.submittedAt,
      ...mapCandidateFields(r, (qs ?? []) as FormQuestion[]),
    }));

    let added = 0;
    if (rows.length) {
      // ignoreDuplicates: existing candidates keep their stage and scores
      const { data, error } = await db
        .from("candidates")
        .upsert(rows, { onConflict: "job_id,external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      added = data?.length ?? 0;
    }
    await db.from("jobs").update({ last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", job.id);
    return { added };
  } catch (e) {
    const msg = errorMessage(e);
    await db.from("jobs").update({ last_sync_error: msg }).eq("id", job.id);
    return { added: 0, error: msg };
  }
}

/**
 * Scores candidates that have no evaluation on the job's current approved rubric.
 * `limit` keeps a single run inside serverless time limits; the next run continues.
 */
export async function scorePending(db: SupabaseClient, job: Job, limit = 8) {
  if (!job.current_rubric_id) return { scored: 0, failed: 0, remaining: 0 };
  const { data: rubric } = await db.from("rubrics").select("status").eq("id", job.current_rubric_id).single();
  if (rubric?.status !== "approved") return { scored: 0, failed: 0, remaining: 0 };

  const { data: cands } = await db
    .from("candidates")
    .select("*, evaluations(rubric_id)")
    .eq("job_id", job.id)
    .neq("score_status", "error") // failed ones wait for a manual retry, so errors don't burn API spend
    .order("created_at");
  const pending = ((cands ?? []) as (Candidate & { evaluations: { rubric_id: string }[] })[]).filter(
    (c) => !c.evaluations.some((e) => e.rubric_id === job.current_rubric_id),
  );

  let scored = 0;
  let failed = 0;
  for (const c of pending.slice(0, limit)) {
    await db.from("candidates").update({ score_status: "scoring", score_error: null }).eq("id", c.id);
    try {
      await scoreCandidate(db, job, job.current_rubric_id, c);
      await db.from("candidates").update({ score_status: "scored" }).eq("id", c.id);
      scored++;
    } catch (e) {
      failed++;
      await db
        .from("candidates")
        .update({ score_status: "error", score_error: errorMessage(e) })
        .eq("id", c.id);
    }
  }
  return { scored, failed, remaining: Math.max(0, pending.length - limit) };
}

export async function runJob(db: SupabaseClient, job: Job, limit?: number) {
  const sync = await syncJob(db, job);
  const score = await scorePending(db, job, limit);
  return { ...sync, ...score };
}
