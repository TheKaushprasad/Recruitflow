import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jevDecide, type JevChoiceQuestion } from "./ai/jev";
import { reviewCandidate, type ReviewCriterion } from "./ai/llm";
import { env } from "./env";
import { aggregate } from "./aggregate";
import { answerFor, checkRule } from "./rules";
import type { Candidate, Criterion, CriterionResult, Decision, Job } from "./types";

interface Final {
  criterion: Criterion;
  decision: Decision;
  confidence: number;
  evidence: string;
  scoredBy: "jev" | "claude" | "openai" | "rule";
  initialConfidence: number | null;
  probabilities: Record<string, number> | null;
}

/** Identity of an AI-judged criterion, independent of rubric version. */
const sig = (c: Pick<Criterion, "kind" | "name" | "description">) => `${c.kind}\u0000${c.name.trim()}\u0000${c.description.trim()}`;

/** Checks every form rule exactly, in code. */
export function applyRules(rules: Criterion[], answers: Candidate["answers"]): Final[] {
  return rules.map((c) => {
    const chk = checkRule(c.rule!, answerFor(c.rule!, answers));
    return {
      criterion: c,
      decision: chk.outcome as Decision,
      confidence: chk.outcome === "unclear" ? 0.5 : 1,
      evidence: chk.detail,
      scoredBy: "rule",
      initialConfidence: null,
      probabilities: null,
    };
  });
}

/**
 * If this candidate was already AI-scored on a rubric version whose AI criteria are
 * identical (same kind, name and description), reuse those results. Changing only
 * form rules or weights then re-applies instantly and costs nothing.
 */
async function reuseAiResults(db: SupabaseClient, candidateId: string, rubricId: string, aiCrit: Criterion[]) {
  const { data: prev } = await db
    .from("evaluations")
    .select("rubric_id, reason, created_at, criterion_results(*)")
    .eq("candidate_id", candidateId)
    .neq("rubric_id", rubricId)
    .order("created_at", { ascending: false })
    .limit(3);
  for (const ev of prev ?? []) {
    const { data: oldCrit } = await db.from("rubric_criteria").select("id, kind, name, description").eq("rubric_id", ev.rubric_id);
    const oldById = new Map((oldCrit ?? []).map((c) => [c.id, c]));
    const bySig = new Map<string, CriterionResult>();
    for (const r of ev.criterion_results as CriterionResult[]) {
      const oc = oldById.get(r.criterion_id);
      if (oc && oc.kind !== "rule" && r.scored_by !== "rule") bySig.set(sig(oc), r);
    }
    if (!aiCrit.every((c) => bySig.has(sig(c)))) continue;
    const finals: Final[] = aiCrit.map((c) => {
      const r = bySig.get(sig(c))!;
      return {
        criterion: c,
        decision: r.decision,
        confidence: Number(r.confidence),
        evidence: r.evidence,
        scoredBy: r.scored_by,
        initialConfidence: r.initial_confidence == null ? null : Number(r.initial_confidence),
        probabilities: r.probabilities,
      };
    });
    return { finals, reason: ev.reason as string };
  }
  return null;
}

/** Jev decides each AI criterion; the AI reviewer rechecks low-confidence ones and writes evidence for all. */
async function scoreWithAi(job: Job, candidate: Candidate, aiCrit: Criterion[]) {
  const threshold = Number(job.recheck_threshold);
  const keyOf = (i: number) => `c${i}`;

  const jev: Record<string, { decision: Decision; confidence: number; probabilities: Record<string, number> | null }> = {};
  if (env.jevConfigured()) {
    const questions: Record<string, JevChoiceQuestion> = {};
    aiCrit.forEach((c, i) => {
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
      { application: candidate.answers.map((a) => ({ question: a.question, answer: a.answer })), resume_link: candidate.resume_url },
      questions,
    );
    aiCrit.forEach((_, i) => {
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

  const reviewInput: ReviewCriterion[] = aiCrit.map((c, i) => {
    const j = jev[keyOf(i)];
    const settled = j && j.confidence >= threshold && j.decision !== "unclear" ? j : undefined;
    return {
      key: keyOf(i),
      kind: c.kind as "hard" | "soft",
      name: c.name,
      description: c.description,
      settled: settled ? { decision: settled.decision, confidence: settled.confidence } : undefined,
    };
  });
  const { output: review, provider: reviewer } = await reviewCandidate({
    jobTitle: job.title,
    criteria: reviewInput,
    answers: candidate.answers,
    resumeUrl: candidate.resume_url,
  });
  const byKey = new Map(review.results.map((r) => [r.key, r]));

  const finals: Final[] = aiCrit.map((c, i) => {
    const k = keyOf(i);
    const j = jev[k];
    const r = byKey.get(k);
    const settled = reviewInput[i].settled;
    const allowed = c.kind === "hard" ? ["pass", "fail", "unclear"] : ["meets", "borderline", "not_met"];
    if (settled) {
      return {
        criterion: c, decision: settled.decision as Decision, confidence: settled.confidence,
        evidence: r?.evidence ?? "", scoredBy: "jev", initialConfidence: null, probabilities: j?.probabilities ?? null,
      };
    }
    const decision = r && allowed.includes(r.decision) ? r.decision : c.kind === "hard" ? "unclear" : "borderline";
    return {
      criterion: c, decision, confidence: clamp(r?.confidence ?? 0), evidence: r?.evidence ?? "No evidence returned.",
      scoredBy: reviewer, initialConfidence: j ? j.confidence : null, probabilities: j?.probabilities ?? null,
    };
  });
  return { finals, reason: review.reason };
}

/**
 * Stage 1 for one candidate against one rubric version:
 * 1. Form rules are checked exactly. Failing a "reject" rule stops here — no AI call.
 * 2. AI criteria are scored (Jev + AI reviewer), or reused from an earlier version
 *    when the AI criteria haven't changed.
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

  const rules = crit.filter((c) => c.kind === "rule" && c.rule);
  const aiCrit = crit.filter((c) => c.kind !== "rule");

  // ---- 1. form rules ----
  const ruleFinals = applyRules(rules, candidate.answers);
  const rejectedBy = ruleFinals.find((f) => f.criterion.rule!.action === "reject" && f.decision === "fail");

  // ---- 2. AI criteria (skipped when a rule already rejected the candidate) ----
  let aiFinals: Final[] = [];
  let aiReason: string | null = null;
  if (!rejectedBy && aiCrit.length) {
    const reused = await reuseAiResults(db, candidate.id, rubricId, aiCrit);
    const scored = reused ?? (await scoreWithAi(job, candidate, aiCrit));
    aiFinals = scored.finals;
    aiReason = scored.reason;
  }

  const finals = [...ruleFinals, ...aiFinals];
  const agg = aggregate(
    finals.map((f) => ({
      kind: f.criterion.kind,
      action: f.criterion.rule?.action,
      weight: f.criterion.weight,
      decision: f.decision,
      confidence: f.confidence,
    })),
    threshold,
  );

  const aiHardFail = aiFinals.find((f) => f.criterion.kind === "hard" && f.decision === "fail");
  const flagged = ruleFinals.filter((f) => f.decision === "unclear" || (f.criterion.rule!.action === "flag" && f.decision === "fail"));
  let reason: string;
  if (rejectedBy) reason = `Fails form rule “${rejectedBy.criterion.name}”: ${rejectedBy.evidence} AI screening skipped.`;
  else if (aiHardFail) reason = `Fails "${aiHardFail.criterion.name}": ${aiHardFail.evidence}`;
  else if (aiReason) reason = aiReason;
  else reason = flagged.length ? "Form rules need a look — see flagged answers." : "Meets every form rule.";
  if (!rejectedBy && flagged.length && aiReason) {
    reason += ` Check form answer${flagged.length === 1 ? "" : "s"}: ${flagged.map((f) => f.criterion.name).join(", ")}.`;
  }

  // ---- 3. persist (replace any previous evaluation for this rubric) ----
  await db.from("evaluations").delete().eq("candidate_id", candidate.id).eq("rubric_id", rubricId);
  const { data: evaluation, error: evErr } = await db
    .from("evaluations")
    .insert({
      recruiter_id: candidate.recruiter_id,
      candidate_id: candidate.id,
      rubric_id: rubricId,
      score: rejectedBy ? 0 : agg.score,
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
