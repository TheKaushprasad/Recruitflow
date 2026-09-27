import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deepEvaluate } from "./ai/llm";
import { aggregate } from "./aggregate";
import { errorMessage } from "./errors";
import { MAX_ATTEMPTS, PermanentError, isPermanentError, retryDelayMs } from "./retry";
import { readCv, readGitHub, readPortfolio } from "./sources";
import type { Candidate, Criterion, CriterionResult, DeepEvaluation, DeepResult, Job } from "./types";

/**
 * Stage 2 (after the recruiter moves a candidate on): reads their CV, portfolio and GitHub,
 * then judges every stage-2 criterion using the JD plus all materials and the form answers.
 * Stage-1 filter results carry over, so a failed "reject" filter still disqualifies.
 * Runs with the service-role client on a row already claimed by the worker (status "running");
 * every query is scoped by ids from the row.
 */
export async function runDeepEvaluation(db: SupabaseClient, row: DeepEvaluation) {
  const evaluationId = row.id;
  try {
    const [{ data: job }, { data: cand }, { data: crit }, { data: stage1 }] = await Promise.all([
      db.from("jobs").select("*").eq("id", row.job_id).single<Job>(),
      db.from("candidates").select("*").eq("id", row.candidate_id).single<Candidate>(),
      db.from("rubric_criteria").select("*").eq("rubric_id", row.rubric_id).eq("enabled", true).order("position"),
      db.from("evaluations").select("reason, score, criterion_results(*)").eq("candidate_id", row.candidate_id).eq("rubric_id", row.rubric_id).maybeSingle(),
    ]);
    if (!job || !cand) throw new PermanentError("Candidate or job no longer exists.");
    const all = (crit ?? []) as Criterion[];

    // Stage-2 rubric; until one is generated, fall back to the stage-1 AI criteria.
    let criteria = all.filter((c) => c.stage === 2 && c.kind !== "rule");
    const usingFallback = !criteria.length;
    if (usingFallback) criteria = all.filter((c) => c.stage === 1 && c.kind !== "rule");
    if (!criteria.length) throw new PermanentError("There's no stage-2 rubric yet. Generate one on the Rubric tab.");

    // Stage-1 results for this candidate, as context and for carried-over filters.
    const byId = new Map(all.map((c) => [c.id, c]));
    const s1 = ((stage1?.criterion_results ?? []) as CriterionResult[])
      .map((r) => ({ r, c: byId.get(r.criterion_id) }))
      .filter((x): x is { r: CriterionResult; c: Criterion } => !!x.c);
    const label = (d: string) => (d === "pass" || d === "meets" ? "met" : d === "fail" || d === "not_met" ? "NOT met" : d === "borderline" ? "partly met" : "unclear");
    const stage1Facts = [
      ...(stage1 ? [`Stage-1 form score: ${stage1.score}. ${stage1.reason}`] : []),
      ...s1.map(({ r, c }) => `${c.kind === "rule" ? "Filter" : "Form criterion"} “${c.name}” — ${label(r.decision)}: ${r.evidence}`),
    ];

    const [cv, portfolio, github] = await Promise.all([readCv(cand.resume_url), readPortfolio(cand.portfolio_url), readGitHub(cand.github_url)]);
    const sources = [cv, portfolio, github].map(({ kind, url, status, note }) => ({ kind, url, status, note }));
    if (![cv, portfolio, github].some((s) => s.status === "read")) {
      throw new PermanentError(
        "None of the candidate's links could be read: " +
          sources.map((s) => `${s.kind === "cv" ? "CV" : s.kind === "github" ? "GitHub" : "portfolio"}: ${s.note}`).join(" · "),
      );
    }

    const keyOf = (i: number) => `c${i}`;
    const { output, provider, model } = await deepEvaluate({
      jobTitle: job.title,
      jobDescription: job.description,
      constraints: job.constraints,
      criteria: criteria.map((c, i) => ({ key: keyOf(i), kind: c.kind as "hard" | "soft", name: c.name, description: c.description })),
      stage1Facts,
      answers: cand.answers,
      cv: cv.status === "read" ? { pdfBase64: cv.pdfBase64, text: cv.text } : null,
      portfolioText: portfolio.status === "read" ? portfolio.text ?? null : null,
      githubText: github.status === "read" ? github.text ?? null : null,
    });

    const byKey = new Map(output.results.map((r) => [r.key, r]));
    // Carry over stage-1 reject/flag filters (not score filters — the stage-2 score is stage-2 criteria only).
    const carried: DeepResult[] = s1
      .filter(({ c }) => c.kind === "rule" && c.rule && c.rule.action !== "score")
      .map(({ r, c }) => ({
        criterion_id: c.id, name: c.name, kind: "rule", action: c.rule!.action, weight: 0,
        decision: r.decision, confidence: Number(r.confidence), evidence: r.evidence, sources: ["form"],
      }));
    const judged: DeepResult[] = criteria.map((c, i) => {
      const r = byKey.get(keyOf(i));
      const allowed = c.kind === "hard" ? ["pass", "fail", "unclear"] : ["meets", "borderline", "not_met"];
      const decision = r && allowed.includes(r.decision) ? r.decision : c.kind === "hard" ? "unclear" : "borderline";
      return {
        criterion_id: c.id, name: c.name, kind: c.kind, weight: c.weight, decision,
        confidence: Math.min(1, Math.max(0, Number(r?.confidence ?? 0))),
        evidence: r?.evidence ?? "No evidence returned.",
        sources: [...new Set(r?.sources ?? [])],
      };
    });
    const results = [...carried, ...judged];
    const agg = aggregate(
      results.map((r) => ({ kind: r.kind, action: r.action, weight: r.weight, decision: r.decision, confidence: r.confidence })),
      Number(job.recheck_threshold),
    );

    await db.from("deep_evaluations").update({
      status: "done",
      score: agg.score,
      confidence: Math.round(agg.confidence * 1000) / 1000,
      disqualified: agg.disqualified,
      verdict: output.verdict,
      summary: usingFallback ? `${output.summary} (Judged on the stage-1 criteria — no stage-2 rubric yet.)` : output.summary,
      strengths: output.strengths.slice(0, 5),
      concerns: output.concerns.slice(0, 5),
      interview_questions: output.interview_questions.slice(0, 5),
      results,
      sources,
      source_snapshot: {
        cv_summary: output.cv_summary || undefined,
        portfolio_excerpt: portfolio.text?.slice(0, 2000),
        github_summary: github.text?.slice(0, 3000),
      },
      provider,
      model,
      finished_at: new Date().toISOString(),
    }).eq("id", evaluationId);
  } catch (e) {
    // Temporary failures (rate limits, timeouts, a site that didn't respond) go back in the queue.
    const attempts = (row.attempts ?? 0) + 1;
    const msg = errorMessage(e);
    if (!(e instanceof PermanentError) && !isPermanentError(msg) && attempts < MAX_ATTEMPTS) {
      await db.from("deep_evaluations").update({
        status: "queued", attempts, error: `Retrying soon — ${msg}`, claimed_at: null,
        next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
      }).eq("id", evaluationId);
      return;
    }
    await db.from("deep_evaluations").update({ status: "error", attempts, error: msg, claimed_at: null, finished_at: new Date().toISOString() }).eq("id", evaluationId);
  }
}
