import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deepEvaluate } from "./ai/llm";
import { aggregate } from "./aggregate";
import { errorMessage } from "./errors";
import { readCv, readGitHub, readPortfolio } from "./sources";
import { applyRules } from "./scoring";
import type { Candidate, Criterion, CriterionResult, DeepResult, Job } from "./types";

/**
 * Stage 2: reads the candidate's CV, portfolio and GitHub, then re-judges every
 * rubric criterion with the AI using all materials plus the form answers.
 * Runs with the service-role client; every query is scoped by ids from the row.
 */
export async function runDeepEvaluation(db: SupabaseClient, evaluationId: string) {
  const { data: row } = await db.from("deep_evaluations").select("*").eq("id", evaluationId).single();
  if (!row || row.status === "done") return;
  await db.from("deep_evaluations").update({ status: "running", error: null }).eq("id", evaluationId);

  try {
    const [{ data: job }, { data: cand }, { data: crit }, { data: stage1 }] = await Promise.all([
      db.from("jobs").select("*").eq("id", row.job_id).single<Job>(),
      db.from("candidates").select("*").eq("id", row.candidate_id).single<Candidate>(),
      db.from("rubric_criteria").select("*").eq("rubric_id", row.rubric_id).eq("enabled", true).order("position"),
      db.from("evaluations").select("criterion_results(*)").eq("candidate_id", row.candidate_id).eq("rubric_id", row.rubric_id).maybeSingle(),
    ]);
    if (!job || !cand) throw new Error("Candidate or job no longer exists.");
    const all = (crit ?? []) as Criterion[];
    if (!all.length) throw new Error("The rubric has no enabled criteria.");
    // Form rules are exact checks — re-applied here, never re-judged by the AI.
    const rules = all.filter((c) => c.kind === "rule" && c.rule);
    const criteria = all.filter((c) => c.kind !== "rule");
    const ruleFinals = applyRules(rules, cand.answers);
    const s1 = new Map(((stage1?.criterion_results ?? []) as CriterionResult[]).map((r) => [r.criterion_id, r]));

    const [cv, portfolio, github] = await Promise.all([
      readCv(cand.resume_url),
      readPortfolio(cand.portfolio_url),
      readGitHub(cand.github_url),
    ]);
    const sources = [cv, portfolio, github].map(({ kind, url, status, note }) => ({ kind, url, status, note }));
    if (![cv, portfolio, github].some((s) => s.status === "read")) {
      throw new Error(
        "None of the candidate's links could be read: " +
          sources.map((s) => `${s.kind === "cv" ? "CV" : s.kind === "github" ? "GitHub" : "portfolio"}: ${s.note}`).join(" · "),
      );
    }

    const keyOf = (i: number) => `c${i}`;
    const { output, provider, model } = await deepEvaluate({
      jobTitle: job.title,
      jobDescription: job.description,
      constraints: job.constraints,
      criteria: criteria.map((c, i) => {
        const r = s1.get(c.id);
        return { key: keyOf(i), kind: c.kind as "hard" | "soft", name: c.name, description: c.description, stage1: r ? { decision: r.decision, evidence: r.evidence } : undefined };
      }),
      ruleFacts: ruleFinals.map((f) => `${f.criterion.name} — ${f.decision === "pass" ? "met" : f.decision === "fail" ? "NOT met" : "unclear"}: ${f.evidence}`),
      answers: cand.answers,
      cv: cv.status === "read" ? { pdfBase64: cv.pdfBase64, text: cv.text } : null,
      portfolioText: portfolio.status === "read" ? portfolio.text ?? null : null,
      githubText: github.status === "read" ? github.text ?? null : null,
    });

    const byKey = new Map(output.results.map((r) => [r.key, r]));
    const ruleResults: DeepResult[] = ruleFinals.map((f) => ({
      criterion_id: f.criterion.id, name: f.criterion.name, kind: "rule", action: f.criterion.rule!.action,
      weight: f.criterion.weight, decision: f.decision, confidence: f.confidence, evidence: f.evidence, sources: ["form"],
    }));
    const aiResults: DeepResult[] = criteria.map((c, i) => {
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
    const results = [...ruleResults, ...aiResults];
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
      summary: output.summary,
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
    await db.from("deep_evaluations").update({ status: "error", error: errorMessage(e), finished_at: new Date().toISOString() }).eq("id", evaluationId);
  }
}
