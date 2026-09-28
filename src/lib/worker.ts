import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withUsage } from "./ai/usage";
import { recruitersOverBudget } from "./budget";
import { runDeepEvaluation } from "./deep";
import { errorMessage } from "./errors";
import { GUEST } from "./guest";
import { syncJob } from "./pipeline";
import { MAX_ATTEMPTS, isPermanentError, retryDelayMs } from "./retry";
import { scoreCandidate } from "./scoring";
import type { Candidate, DeepEvaluation, Job } from "./types";

/**
 * Background queue worker. Candidates and stage-2 reviews are claimed atomically in the database
 * (claim_scoring / claim_deep), so any number of workers can run at once — the every-minute
 * scheduler, "Sync now", a rubric approval — without scoring anyone twice.
 */

/** Time one item may take, kept free before the deadline so we never start work we can't finish. */
const STAGE1_RESERVE_MS = 45_000;
const STAGE2_RESERVE_MS = 120_000;

export interface WorkerOptions {
  /** Epoch ms after which no new work is started. */
  deadline: number;
  /** Only this job's candidates (stage 1). */
  jobId?: string;
  /** Candidates scored in parallel. */
  concurrency?: number;
}

/** Stage 1: score queued candidates until the queue is empty or time runs out. */
export async function workStage1(db: SupabaseClient, opts: WorkerOptions) {
  const exclude = await recruitersOverBudget(db);
  const jobs = new Map<string, Job | null>();
  const jobFor = async (id: string) => {
    if (!jobs.has(id)) {
      const { data } = await db.from("jobs").select("*").eq("id", id).maybeSingle<Job>();
      jobs.set(id, data);
    }
    return jobs.get(id)!;
  };

  let scored = 0, failed = 0;
  while (Date.now() < opts.deadline - STAGE1_RESERVE_MS) {
    const { data, error } = await db.rpc("claim_scoring", {
      p_limit: opts.concurrency ?? 4,
      p_job: opts.jobId ?? null,
      p_exclude: exclude,
    });
    if (error) throw new Error(`Couldn't read the scoring queue: ${error.message}`);
    const batch = (data ?? []) as Candidate[];
    if (!batch.length) break;
    const results = await Promise.all(
      batch.map(async (c) => {
        const job = await jobFor(c.job_id);
        return job?.current_rubric_id ? scoreOne(db, job, c) : release(db, c);
      }),
    );
    scored += results.filter((r) => r === "scored").length;
    failed += results.filter((r) => r === "failed").length;
  }
  return { scored, failed };
}

async function scoreOne(db: SupabaseClient, job: Job, c: Candidate): Promise<"scored" | "failed" | "retry"> {
  try {
    await withUsage({ recruiterId: job.recruiter_id, jobId: job.id, purpose: "stage1" }, () =>
      scoreCandidate(db, job, job.current_rubric_id!, c),
    );
    await db.from("candidates").update({
      score_status: "scored", score_error: null, score_attempts: 0, next_attempt_at: null, claimed_at: null,
    }).eq("id", c.id);
    return "scored";
  } catch (e) {
    const msg = errorMessage(e);
    const attempts = (c.score_attempts ?? 0) + 1;
    if (!isPermanentError(msg) && attempts < MAX_ATTEMPTS) {
      await db.from("candidates").update({
        score_status: "pending", score_attempts: attempts, claimed_at: null,
        score_error: `Retrying soon — ${msg}`,
        next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      }).eq("id", c.id);
      return "retry";
    }
    await db.from("candidates").update({ score_status: "error", score_attempts: attempts, score_error: msg, claimed_at: null }).eq("id", c.id);
    return "failed";
  }
}

/** The job lost its approved rubric between claim and scoring: put the candidate back. */
async function release(db: SupabaseClient, c: Candidate) {
  await db.from("candidates").update({ score_status: "pending", claimed_at: null }).eq("id", c.id);
  return "released" as const;
}

/** Stage 2: run queued CV reviews until none are left or time runs out. */
export async function workStage2(db: SupabaseClient, opts: WorkerOptions & { ids?: string[] }) {
  const exclude = await recruitersOverBudget(db);
  let done = 0;
  while (Date.now() < opts.deadline - STAGE2_RESERVE_MS) {
    const { data, error } = await db.rpc("claim_deep", {
      p_limit: opts.concurrency ?? 2,
      p_ids: opts.ids ?? null,
      p_exclude: exclude,
    });
    if (error) throw new Error(`Couldn't read the stage-2 queue: ${error.message}`);
    const batch = (data ?? []) as (DeepEvaluation & { recruiter_id: string })[];
    if (!batch.length) break;
    await Promise.all(
      batch.map((row) =>
        withUsage({ recruiterId: row.recruiter_id, jobId: row.job_id, purpose: "stage2" }, () => runDeepEvaluation(db, row)),
      ),
    );
    done += batch.length;
  }
  return { done };
}

/** Pull new form responses for open jobs that haven't synced in the last `staleMs`. */
export async function syncDueJobs(db: SupabaseClient, deadline: number, staleMs = 2 * 60_000) {
  const { data } = await db
    .from("jobs")
    .select("*")
    .eq("status", "open")
    .or("google_form_id.not.is.null,sheet_id.not.is.null");
  const due = ((data ?? []) as Job[]).filter((j) => !j.last_synced_at || Date.now() - new Date(j.last_synced_at).getTime() > staleMs);
  let added = 0;
  for (const job of due) {
    if (Date.now() > deadline - 60_000) break;
    added += (await syncJob(db, job)).added;
  }
  return { added };
}

/** One scheduler tick: sync due jobs, then work both queues side by side until the deadline. */
export async function runWorker(db: SupabaseClient, budgetMs = 250_000) {
  const deadline = Date.now() + budgetMs;
  const { data: expiredGuests } = await db.rpc("delete_expired_guests", { p_hours: GUEST.lifetimeHours });
  const sync = await syncDueJobs(db, deadline);
  const [stage1, stage2] = await Promise.all([workStage1(db, { deadline }), workStage2(db, { deadline })]);
  return { ...sync, ...stage1, stage2: stage2.done, expiredGuests: Number(expiredGuests ?? 0) };
}
