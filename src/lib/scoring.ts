import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jevDecide, type JevChoiceQuestion } from "./ai/jev";
import { reviewCandidate, type ReviewCriterion } from "./ai/claude";
import { env } from "./env";
import { aggregate } from "./aggregate";
import type { Candidate, Criterion, Decision, Job } from "./types";

interface Final {
  criterion: Criterion;
  decision: Decision;
  confidence: number;
  evidence: string;
  scoredBy: "jev" | "claude";
  initialConfidence: number | null;
  probabilities: Record<string, number> | null;
}

/**
 * Scores one candidate against one rubric:
 * 1. Jev decides every criterion (fast, calibrated confidence).
 * 2. Claude rechecks anything below the job's threshold and writes evidence for all.
 * Without a Jev key, Claude decides everything.
 */
export async function scoreCandidate(db: SupabaseClient, job: Job, rubricId: string, candidate: Candidate) {
  const { data: criteria, error } = await db
    .from("rubric_criteria")
    .select("*")
    .eq("rubric_id", rubricId)
    .eq("enabled", true)
    .order("position");
  if (error) throw new Error(error.message);
  const crit = (criteria ?? []) as Criterion[];
  if (!crit.length) throw new Error("Rubric has no enabled criteria.");

  const threshold = Number(job.recheck_threshold);
  const keyOf = (i: number) => `c${i}`;

  // ---- 1. Jev ----
  const jev: Record<string, { decision: Decision; confidence: number; probabilities: Record<string, number> | null }> = {};
  if (env.jevConfigured()) {
    const questions: Record<string, JevChoiceQuestion> = {};
    crit.forEach((c, i) => {
      questions[keyOf(i)] =
        c.kind === "hard"
          ? {
              type: "choice",
              instructions: `Hiring requirement for "${job.title}": ${c.name}. ${c.description} Does the application satisfy it?`,
              criteria: {
                pass: "The application clearly satisfies the requirement.",
                fail: "The application clearly does not satisfy the requirement.",
                unclear: "The application doesn't give enough information to tell.",
              },
            }
          : {
              type: "choice",
              instructions: `Assess the applicant for "${job.title}" on: ${c.name}. ${c.description}`,
              criteria: {
                meets: "Specific, concrete evidence that the applicant fully meets this.",
                borderline: "Partial or vague evidence; meets it only in part.",
                not_met: "No evidence, or evidence that they don't meet it.",
              },
            };
    });
    const answers = await jevDecide(
      {
        application: candidate.answers.map((a) => ({ question: a.question, answer: a.answer })),
        resume_link: candidate.resume_url,
      },
      questions,
    );
    crit.forEach((_, i) => {
      const a = answers[keyOf(i)];
      if (a?.choice) {
        jev[keyOf(i)] = {
          decision: a.choice as Decision,
          confidence: a.confidence ?? Math.max(...Object.values(a.probabilities ?? { x: 0 })),
          probabilities: a.probabilities ?? null,
        };
      }
    });
  }

  // ---- 2. Claude: evidence for everything, decisions for low-confidence ----
  const reviewInput: ReviewCriterion[] = crit.map((c, i) => {
    const j = jev[keyOf(i)];
    const settled = j && j.confidence >= threshold && j.decision !== "unclear" ? j : undefined;
    return {
      key: keyOf(i),
      kind: c.kind,
      name: c.name,
      description: c.description,
      settled: settled ? { decision: settled.decision, confidence: settled.confidence } : undefined,
    };
  });
  const review = await reviewCandidate({
    jobTitle: job.title,
    criteria: reviewInput,
    answers: candidate.answers,
    resumeUrl: candidate.resume_url,
  });
  const byKey = new Map(review.results.map((r) => [r.key, r]));

  const finals: Final[] = crit.map((c, i) => {
    const k = keyOf(i);
    const j = jev[k];
    const r = byKey.get(k);
    const settled = reviewInput[i].settled;
    const allowed = c.kind === "hard" ? ["pass", "fail", "unclear"] : ["meets", "borderline", "not_met"];
    if (settled) {
      return {
        criterion: c,
        decision: settled.decision as Decision,
        confidence: settled.confidence,
        evidence: r?.evidence ?? "",
        scoredBy: "jev",
        initialConfidence: null,
        probabilities: j?.probabilities ?? null,
      };
    }
    const decision = r && allowed.includes(r.decision) ? r.decision : c.kind === "hard" ? "unclear" : "borderline";
    return {
      criterion: c,
      decision,
      confidence: clamp(r?.confidence ?? 0),
      evidence: r?.evidence ?? "No evidence returned.",
      scoredBy: "claude",
      initialConfidence: j ? j.confidence : null,
      probabilities: j?.probabilities ?? null,
    };
  });

  const agg = aggregate(
    finals.map((f) => ({ kind: f.criterion.kind, weight: f.criterion.weight, decision: f.decision, confidence: f.confidence })),
    threshold,
  );
  const failed = finals.find((f) => f.criterion.kind === "hard" && f.decision === "fail");
  const reason = failed ? `Fails "${failed.criterion.name}": ${failed.evidence}` : review.reason;

  // ---- 3. persist (replace any previous evaluation for this rubric) ----
  await db.from("evaluations").delete().eq("candidate_id", candidate.id).eq("rubric_id", rubricId);
  const { data: evaluation, error: evErr } = await db
    .from("evaluations")
    .insert({
      recruiter_id: candidate.recruiter_id,
      candidate_id: candidate.id,
      rubric_id: rubricId,
      score: agg.score,
      confidence: round3(agg.confidence),
      disqualified: agg.disqualified,
      needs_review: agg.needsReview,
      reason,
    })
    .select("id")
    .single();
  if (evErr) throw new Error(evErr.message);

  const { error: crErr } = await db.from("criterion_results").insert(
    finals.map((f) => ({
      recruiter_id: candidate.recruiter_id,
      evaluation_id: evaluation.id,
      criterion_id: f.criterion.id,
      decision: f.decision,
      confidence: round3(f.confidence),
      evidence: f.evidence,
      scored_by: f.scoredBy,
      initial_confidence: f.initialConfidence == null ? null : round3(f.initialConfidence),
      probabilities: f.probabilities,
    })),
  );
  if (crErr) throw new Error(crErr.message);
  return agg;
}

function clamp(n: number) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
function round3(n: number) {
  return Math.round(clamp(n) * 1000) / 1000;
}
