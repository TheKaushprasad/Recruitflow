"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { GUEST, guestAiBlocked } from "@/lib/guest";
import { DEMO_MODEL } from "@/lib/demo/seed";
import { createAdminClient } from "@/lib/supabase/admin";
import { workStage2 } from "@/lib/worker";
import { errorMessage } from "@/lib/errors";
import { normalizeUrl } from "@/lib/urls";
import type { Job } from "@/lib/types";
import type { ActionResult } from "./jobs";

/** Reviews run from a queue (a few at a time, finished by the every-minute scheduler). */
const MAX_PER_RUN = 100;

/** Runs (or re-runs) the stage-2 evaluation: CV + portfolio + GitHub against the JD and stage-2 rubric. */
export async function startDeepEvaluation(jobId: string, candidateIds: string[]): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    if (!candidateIds.length) return { ok: false, error: "Select at least one candidate." };
    if (user.isGuest) {
      // The sample reviews don't count; guests can run a few of their own.
      const { count } = await supabase.from("deep_evaluations").select("id", { count: "exact", head: true }).or(`model.is.null,model.neq.${DEMO_MODEL}`);
      if ((count ?? 0) + candidateIds.length > GUEST.cvReviews) {
        return { ok: false, error: `The demo includes ${GUEST.cvReviews} CV review of your own (the sample reviews are already done). Create a free account to review more.` };
      }
      const why = await guestAiBlocked();
      if (why) return { ok: false, error: why };
    }
    if (candidateIds.length > MAX_PER_RUN) return { ok: false, error: `Evaluate up to ${MAX_PER_RUN} candidates at a time.` };
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    if (!job.current_rubric_id) return { ok: false, error: "Approve a rubric first — the evaluation judges candidates against it." };

    const { data: cands } = await supabase
      .from("candidates")
      .select("id, name, resume_url, portfolio_url, github_url, deep_evaluations(id, status)")
      .in("id", candidateIds)
      .eq("job_id", jobId);
    const list = (cands ?? []) as { id: string; name: string; resume_url: string | null; portfolio_url: string | null; github_url: string | null; deep_evaluations: { id: string; status: string }[] }[];
    const busy = list.filter((c) => c.deep_evaluations.some((d) => d.status === "queued" || d.status === "running"));
    const noLinks = list.filter((c) => !c.resume_url && !c.portfolio_url && !c.github_url);
    const todo = list.filter((c) => !busy.includes(c) && !noLinks.includes(c));
    if (!todo.length) {
      return { ok: false, error: noLinks.length ? `${noLinks.map((c) => c.name).join(", ")} ${noLinks.length === 1 ? "has" : "have"} no CV, portfolio or GitHub link. Add one in their profile first.` : "Those candidates are already being evaluated." };
    }

    const { data: rows, error } = await supabase
      .from("deep_evaluations")
      .insert(todo.map((c) => ({ job_id: jobId, candidate_id: c.id, rubric_id: job.current_rubric_id, status: "queued" })))
      .select("id");
    if (error) return { ok: false, error: errorMessage(error) };

    const ids = (rows ?? []).map((r) => r.id as string);
    after(async () => {
      await workStage2(createAdminClient(), { ids, deadline: Date.now() + 250_000, concurrency: 3 });
    });

    revalidatePath(`/jobs/${jobId}`, "layout");
    const skipped = [...busy, ...noLinks].length;
    return {
      ok: true,
      message: `Evaluating ${todo.length} candidate${todo.length === 1 ? "" : "s"} — about 30–60 seconds each, 3 at a time.${skipped ? ` Skipped ${skipped} (already running or no links).` : ""}`,
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * The recruiter moves candidates to stage 2 (after reading their stage-1 result).
 * That starts the CV + portfolio + GitHub evaluation for everyone with at least one link.
 */
export async function moveToStage2(jobId: string, candidateIds: string[]): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    if (!candidateIds.length) return { ok: false, error: "Select at least one candidate." };
    if (candidateIds.length > MAX_PER_RUN) return { ok: false, error: `Move up to ${MAX_PER_RUN} candidates at a time.` };
    const { data: moved, error } = await supabase
      .from("candidates")
      .update({ stage2_at: new Date().toISOString() })
      .in("id", candidateIds)
      .eq("job_id", jobId)
      .is("stage2_at", null)
      .select("id");
    if (error) return { ok: false, error: errorMessage(error) };
    const eval_ = await startDeepEvaluation(jobId, candidateIds);
    revalidatePath(`/jobs/${jobId}`, "layout");
    const n = moved?.length ?? 0;
    const head = n ? `Moved ${n} to stage 2.` : "Already in stage 2.";
    return eval_.ok ? { ok: true, message: `${head} ${eval_.message ?? ""}`.trim() } : { ok: true, message: `${head} ${eval_.error}` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** Sends candidates back to stage 1. Their stage-2 evaluations are kept for the record. */
export async function removeFromStage2(jobId: string, candidateIds: string[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("candidates").update({ stage2_at: null }).in("id", candidateIds).eq("job_id", jobId);
  if (error) return { ok: false, error: errorMessage(error) };
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: "Moved back to stage 1." };
}

/** Recruiter edits a candidate's CV / portfolio / GitHub links before evaluating. */
export async function saveCandidateLinks(
  candidateId: string,
  links: { resume_url: string; portfolio_url: string; github_url: string },
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(links)) {
    const t = v.trim();
    if (!t) { clean[k] = null; continue; }
    const n = normalizeUrl(t, k === "github_url" ? "github" : undefined);
    if (!n) return { ok: false, error: `“${t}” isn't a valid link.` };
    clean[k] = n;
  }
  const { data, error } = await supabase.from("candidates").update(clean).eq("id", candidateId).select("job_id").single();
  if (error) return { ok: false, error: errorMessage(error) };
  revalidatePath(`/jobs/${data.job_id}`, "layout");
  return { ok: true, message: "Links saved" };
}
