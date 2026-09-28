import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregate } from "../aggregate";
import { answerFor, checkRule } from "../rules";
import { summarise } from "../summary";
import type { Decision, DeepResult } from "../types";
import { DEMO_CANDIDATES, DEMO_JOB, DEMO_QUESTIONS, DEMO_RULES, DEMO_STAGE2, DEMO_STAGES } from "./fixture";

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
  const threshold = 0.7;

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
  const answersOf = (c: (typeof DEMO_CANDIDATES)[number]) => [
    { question: "Full name", answer: c.name },
    { question: "Email", answer: c.email },
    { question: "Current city", answer: c.answers.city },
    { question: "Notice period", answer: c.answers.notice },
    { question: "Expected CTC", answer: c.answers.ctc },
    { question: "Years of product management experience", answer: c.answers.years },
    { question: "Tell us about an AI or ML product or feature you shipped", answer: c.answers.project },
    { question: "How do you decide what to build next? Share a recent example.", answer: c.answers.prio },
    { question: "CV link", answer: "" },
    { question: "Portfolio or GitHub", answer: "" },
  ];
  const cands = must(
    await db.from("candidates").insert(DEMO_CANDIDATES.map((c, i) => ({
      recruiter_id: rid, job_id: job.id, external_id: `demo-seed-${i}`, name: c.name, email: c.email,
      answers: answersOf(c), submitted_at: ago(c.minutesAgo), created_at: ago(c.minutesAgo), score_status: "scored",
      stage2_at: c.stage2 ? ago(Math.max(5, c.minutesAgo - 120)) : null,
      stage_id: c.pipeline ? stageId(c.pipeline) : null,
    }))).select("id, external_id"),
    "candidates",
  ) as { id: string; external_id: string }[];
  const candId = (i: number) => cands.find((c) => c.external_id === `demo-seed-${i}`)!.id;

  // Stage 1: exact rules re-checked in code, AI decisions from the fixture, scored like the real thing.
  const results = DEMO_CANDIDATES.map((c) => {
    const answers = answersOf(c);
    const finals = DEMO_RULES.map((r) => {
      if (r.rule.op === "in") {
        const chk = checkRule(r.rule, answerFor(r.rule, answers));
        return { r, decision: chk.outcome as Decision, confidence: chk.outcome === "unclear" ? 0.5 : 1, evidence: chk.detail, by: "rule" as const, init: null };
      }
      const [decision, confidence, evidence, by = "jev", init = null] = c.ai[r.key as keyof typeof c.ai];
      return { r, decision, confidence, evidence, by, init };
    });
    const agg = aggregate(
      finals.map((f) => ({ kind: "rule" as const, action: f.r.rule.action, weight: f.r.weight, decision: f.decision, confidence: f.confidence, judgedByAi: f.by !== "rule" })),
      threshold, { filterPoints: true },
    );
    const rejected = finals.find((f) => f.r.rule.action === "reject" && f.decision === "fail");
    const reason = rejected
      ? `Fails filter “${rejected.r.name}”: ${rejected.evidence} AI screening skipped.`
      : c.reason || summarise(finals.map((f) => ({ criterion: { name: f.r.name }, decision: f.decision })));
    // A rejecting filter stops screening before any AI call, as in the live app.
    const kept = rejected ? finals.filter((f) => f.by === "rule") : finals;
    return { c, finals: kept, agg, rejected, reason };
  });

  const evals = must(
    await db.from("evaluations").insert(results.map((x, i) => ({
      recruiter_id: rid, candidate_id: candId(i), rubric_id: rubricId,
      score: x.rejected ? 0 : x.agg.score, confidence: Math.round(x.agg.confidence * 1000) / 1000,
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
    const carried: DeepResult[] = results[i].finals
      .filter((f) => f.r.rule.action !== "score")
      .map((f) => ({ criterion_id: critId(f.r.name), name: f.r.name, kind: "rule", action: f.r.rule.action, weight: 0, decision: f.decision, confidence: f.confidence, evidence: f.evidence || "Checked on the form answer.", sources: ["form"] }));
    const judged: DeepResult[] = DEMO_STAGE2.map((d) => {
      const [decision, confidence, evidence, sources] = s.results[d.key];
      return { criterion_id: critId(d.name), name: d.name, kind: d.kind, weight: d.weight, decision, confidence, evidence, sources };
    });
    const all = [...carried, ...judged];
    const agg = aggregate(all.map((r) => ({ kind: r.kind, action: r.action, weight: r.weight, decision: r.decision, confidence: r.confidence })), threshold);
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
