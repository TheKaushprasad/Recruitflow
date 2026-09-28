import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeepResult } from "../types";
import { DEMO_CANDIDATES, DEMO_JOB, DEMO_QUESTIONS, DEMO_RULES, DEMO_STAGE2, DEMO_STAGES } from "./fixture";
import { DEMO_THRESHOLD, demoAnswers, scoreStage1, scoreStage2 } from "./score";

/** Marks pre-written stage-2 reviews, so guest limits count only the reviews they run themselves. */
export const DEMO_MODEL = "demo-sample";
/** Monthly AI budget for a guest workspace (in USD); scoring pauses when it's used up. */
export const GUEST_BUDGET_USD = 0.3;

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error || !r.data) throw new Error(`Couldn't create the demo ${what}: ${r.error?.message ?? "no data"}`);
  return r.data;
};

/**
 * Builds a guest's workspace: one open job with a form, an approved two-stage rubric, a pipeline,
 * and scored candidates (a few already reviewed in stage 2, one with an interview booked).
 * Runs with the service-role client, so every row sets recruiter_id explicitly.
 */
export async function seedDemo(db: SupabaseClient, userId: string): Promise<string> {
  const rid = userId;
  const threshold = DEMO_THRESHOLD;

  const job = must(
    await db.from("jobs").insert({
      recruiter_id: rid, ...DEMO_JOB, form_source: "built", recheck_threshold: threshold, require_signoff: true,
      created_at: ago(60 * 72),
    }).select("id").single<{ id: string }>(),
    "job",
  );

  const [qs, stages, rubric] = await Promise.all([
    db.from("form_questions").insert(DEMO_QUESTIONS.map((q, i) => ({
      recruiter_id: rid, job_id: job.id, position: i, title: q.title, type: q.type, options: q.options ?? [], role: q.role ?? null, required: !!q.required,
    }))),
    db.from("stages").insert(DEMO_STAGES.map((s, i) => ({ recruiter_id: rid, job_id: job.id, position: i, ...s }))).select("id, name"),
    db.from("rubrics").insert({
      recruiter_id: rid, job_id: job.id, version: 1, status: "approved", bias_reviewed: true, source: "openai", model: "gpt-5.4",
      created_at: ago(60 * 71), approved_at: ago(60 * 70),
    }).select("id").single<{ id: string }>(),
  ]);
  if (qs.error) throw new Error(`Couldn't create the demo form: ${qs.error.message}`);
  const stageRows = must(stages, "pipeline") as { id: string; name: string }[];
  const rubricId = must(rubric, "rubric").id;
  const stageId = (name: string) => stageRows.find((s) => s.name === name)!.id;

  const critRows = must(
    await db.from("rubric_criteria").insert([
      ...DEMO_RULES.map((r, i) => ({
        recruiter_id: rid, rubric_id: rubricId, position: i, stage: 1, kind: "rule", name: r.name,
        description: "", weight: r.weight, rule: r.rule, enabled: true,
      })),
      ...DEMO_STAGE2.map((c, i) => ({
        recruiter_id: rid, rubric_id: rubricId, position: i, stage: 2, kind: c.kind, name: c.name,
        description: c.description, weight: c.weight, bias_flag: c.bias_flag ?? null, enabled: true,
      })),
    ]).select("id, name, stage"),
    "rubric criteria",
  ) as { id: string; name: string; stage: number }[];
  const critId = (name: string) => critRows.find((c) => c.name === name)!.id;
  await db.from("jobs").update({ current_rubric_id: rubricId }).eq("id", job.id);

  // Candidates, with their form answers in the form's question order.
  const cands = must(
    await db.from("candidates").insert(DEMO_CANDIDATES.map((c, i) => ({
      recruiter_id: rid, job_id: job.id, external_id: `demo-seed-${i}`, name: c.name, email: c.email,
      answers: demoAnswers(c), submitted_at: ago(c.minutesAgo), created_at: ago(c.minutesAgo), score_status: "scored",
      stage2_at: c.stage2 ? ago(Math.max(5, c.minutesAgo - 120)) : null,
      stage_id: c.pipeline ? stageId(c.pipeline) : null,
    }))).select("id, external_id"),
    "candidates",
  ) as { id: string; external_id: string }[];
  const candId = (i: number) => cands.find((c) => c.external_id === `demo-seed-${i}`)!.id;

  // Stage 1: exact rules re-checked in code, AI decisions from the fixture, scored like the real thing.
  const results = DEMO_CANDIDATES.map((c) => ({ c, ...scoreStage1(c) }));

  const evals = must(
    await db.from("evaluations").insert(results.map((x, i) => ({
      recruiter_id: rid, candidate_id: candId(i), rubric_id: rubricId,
      score: x.score, confidence: Math.round(x.agg.confidence * 1000) / 1000,
      disqualified: x.agg.disqualified, needs_review: x.agg.needsReview, reason: x.reason,
      created_at: ago(Math.max(1, x.c.minutesAgo - 2)),
    }))).select("id, candidate_id"),
    "scores",
  ) as { id: string; candidate_id: string }[];
  const evalFor = (i: number) => evals.find((e) => e.candidate_id === candId(i))!.id;

  const { error: crErr } = await db.from("criterion_results").insert(results.flatMap((x, i) =>
    x.finals.map((f) => ({
      recruiter_id: rid, evaluation_id: evalFor(i), criterion_id: critId(f.r.name), decision: f.decision,
      confidence: Math.round(f.confidence * 1000) / 1000, evidence: f.evidence, scored_by: f.by,
      initial_confidence: f.init, probabilities: null,
    })),
  ));
  if (crErr) throw new Error(`Couldn't create the demo evidence: ${crErr.message}`);

  // Stage 2: pre-written CV reviews for the candidates already moved on.
  const deepRows = DEMO_CANDIDATES.flatMap((c, i) => {
    if (!c.stage2) return [];
    const s = c.stage2;
    const { results: scored, agg } = scoreStage2(c, results[i].finals)!;
    const all: DeepResult[] = scored.map((r) => ({ ...r, criterion_id: critId(r.name) }));
    const reviewedAt = ago(Math.max(3, c.minutesAgo - 150));
    return [{
      recruiter_id: rid, job_id: job.id, candidate_id: candId(i), rubric_id: rubricId, status: "done",
      score: agg.score, confidence: Math.round(agg.confidence * 1000) / 1000, disqualified: agg.disqualified,
      verdict: s.verdict, summary: s.summary, strengths: s.strengths, concerns: s.concerns, interview_questions: s.questions,
      results: all,
      sources: [
        { kind: "cv", url: null, status: "read", note: "Sample CV (demo)" },
        { kind: "portfolio", url: null, status: "missing", note: "No link" },
        { kind: "github", url: null, status: "missing", note: "No link" },
      ],
      source_snapshot: { cv_summary: s.cvSummary },
      provider: "openai", model: DEMO_MODEL, created_at: reviewedAt, finished_at: reviewedAt,
    }];
  });
  if (deepRows.length) {
    const { error } = await db.from("deep_evaluations").insert(deepRows);
    if (error) throw new Error(`Couldn't create the demo CV reviews: ${error.message}`);
  }

  // One interview on the calendar (no Google event in the demo).
  const interviews = DEMO_CANDIDATES.flatMap((c, i) => c.interviewInDays == null || !c.pipeline ? [] : [{
    recruiter_id: rid, job_id: job.id, candidate_id: candId(i), stage_id: stageId(c.pipeline),
    starts_at: new Date(Math.ceil((Date.now() + c.interviewInDays * 864e5) / 36e5) * 36e5).toISOString(),
    duration_min: 45, attendees: [c.email],
  }]);
  await Promise.all([
    interviews.length ? db.from("interviews").insert(interviews) : null,
    db.from("recruiter_settings").upsert({ recruiter_id: rid, monthly_ai_budget_usd: GUEST_BUDGET_USD }),
  ]);

  return job.id;
}
