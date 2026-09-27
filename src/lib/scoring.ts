import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jevDecide, type JevChoiceQuestion } from "./ai/jev";
import { reviewCandidate, type ReviewCriterion } from "./ai/llm";
import { env } from "./env";
import { aggregate } from "./aggregate";
import { summarise } from "./summary";
import { answerFor, checkRule, isAiRule, isExpectedAnswerRule } from "./rules";
import type { Candidate, Criterion, CriterionResult, Decision, Job } from "./types";

export interface Final {
  criterion: Criterion;
  decision: Decision;
  confidence: number;
  evidence: string;
  scoredBy: "jev" | "claude" | "openai" | "rule";
  initialConfidence: number | null;
  probabilities: Record<string, number> | null;
}

/** Stage-1 items the AI judges: AI-check filters on free-text answers, AI filters, and scored criteria. */
const isAiJudged = (c: Criterion) => c.kind !== "rule" || isAiRule(c.rule);

/** Identity of an AI-judged item, independent of rubric version (for reusing results). */
const sig = (c: Pick<Criterion, "kind" | "name" | "description" | "rule">) =>
  [c.kind, c.name.trim(), c.description.trim(), c.rule?.question ?? "", c.rule?.instruction ?? ""].join("\u0000");

/** How an AI-judged item is presented to Jev / the reviewer. AI-check filters are pass/fail filters on one answer. */
function asReview(c: Criterion): { kind: "hard" | "soft"; name: string; description: string } {
  if (c.kind === "rule" && isExpectedAnswerRule(c.rule)) {
    return {
      kind: "soft",
      name: c.name,
      description:
        `Grade the answer to “${c.rule!.question}” using the expected answer below as a yardstick of relevance and substance — NOT a checklist. ` +
        `"meets" = clearly the same kind of work AND at least two concrete specifics (their own role or decisions, what was built, tools, or an outcome/metric); it does NOT need to cover every point in the expected answer. ` +
        `"borderline" = relevant but vague or generic (few or no specifics), or only loosely related work described specifically. ` +
        `"not_met" = unrelated work, or empty/non-answer. Never penalise brevity or writing style. ` +
        `Expected answer: ${c.rule!.instruction}`,
    };
  }
  if (c.kind === "rule") {
    return { kind: "hard", name: c.name, description: `Answer to “${c.rule!.question}” must meet: ${c.rule!.instruction}` };
  }
  return { kind: c.kind as "hard" | "soft", name: c.name, description: c.description };
}

/** Exact filters, checked in code. */
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
 * Reuse AI results from an earlier rubric version when the stage-1 AI items are identical,
 * so editing only exact filters, weights or the stage-2 rubric re-applies instantly and for free.
 */
async function reuseAiResults(db: SupabaseClient, candidateId: string, rubricId: string, aiItems: Criterion[]) {
  const { data: prev } = await db
    .from("evaluations")
    .select("rubric_id, reason, created_at, criterion_results(*)")
    .eq("candidate_id", candidateId)
    .neq("rubric_id", rubricId)
    .order("created_at", { ascending: false })
    .limit(3);
  for (const ev of prev ?? []) {
    const { data: oldCrit } = await db.from("rubric_criteria").select("id, kind, name, description, rule").eq("rubric_id", ev.rubric_id);
    const oldById = new Map((oldCrit ?? []).map((c) => [c.id, c]));
    const bySig = new Map<string, CriterionResult>();
    for (const r of ev.criterion_results as CriterionResult[]) {
      const oc = oldById.get(r.criterion_id);
      if (oc && r.scored_by !== "rule") bySig.set(sig(oc as Criterion), r);
    }
    if (!aiItems.every((c) => bySig.has(sig(c)))) continue;
    const finals: Final[] = aiItems.map((c) => {
      const r = bySig.get(sig(c))!;
      return {
        criterion: c, decision: r.decision, confidence: Number(r.confidence), evidence: r.evidence, scoredBy: r.scored_by,
        initialConfidence: r.initial_confidence == null ? null : Number(r.initial_confidence), probabilities: r.probabilities,
      };
    });
    return { finals, reason: ev.reason as string };
  }
  return null;
}

/**
 * Jev decides each item. OpenAI is called only for the items Jev is unsure about (below the
 * recheck threshold, or "unclear") — or for everything when Jev isn't configured. When Jev is sure
 * about all of them, no OpenAI call is made; evidence for Jev's decisions is written on demand
 * ("Explain" in the candidate panel).
 */
async function scoreWithAi(job: Job, rubricId: string, candidate: Candidate, items: Criterion[]) {
  const threshold = Number(job.recheck_threshold);
  const keyOf = (i: number) => `c${i}`;
  const view = items.map(asReview);

  const jev: Record<string, { decision: Decision; confidence: number; probabilities: Record<string, number> | null }> = {};
  if (env.jevConfigured()) {
    const questions: Record<string, JevChoiceQuestion> = {};
    view.forEach((c, i) => {
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
    const answers = await jevDecide({ application: candidate.answers.map((a) => ({ question: a.question, answer: a.answer })) }, questions);
    view.forEach((_, i) => {
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

  const reviewInput: ReviewCriterion[] = view.map((c, i) => {
    const j = jev[keyOf(i)];
    const settled = j && j.confidence >= threshold && j.decision !== "unclear" ? j : undefined;
    return { key: keyOf(i), ...c, settled: settled ? { decision: settled.decision, confidence: settled.confidence } : undefined };
  });
  const needsAi = reviewInput.some((c) => !c.settled);
  const reviewed = needsAi
    ? await reviewCandidate({ jobTitle: job.title, rubricId, criteria: reviewInput, answers: candidate.answers })
    : null;
  const byKey = new Map((reviewed?.output.results ?? []).map((r) => [r.key, r]));

  const finals: Final[] = items.map((c, i) => {
    const k = keyOf(i);
    const j = jev[k];
    const settled = reviewInput[i].settled;
    if (settled) {
      return {
        criterion: c, decision: settled.decision as Decision, confidence: settled.confidence,
        evidence: "", scoredBy: "jev", initialConfidence: null, probabilities: j?.probabilities ?? null,
      };
    }
    const r = byKey.get(k);
    const hardLike = view[i].kind === "hard";
    const allowed = hardLike ? ["pass", "fail", "unclear"] : ["meets", "borderline", "not_met"];
    const decision = r && allowed.includes(r.decision) ? r.decision : hardLike ? "unclear" : "borderline";
    return {
      criterion: c, decision, confidence: clamp(r?.confidence ?? 0), evidence: r?.evidence ?? "No evidence returned.",
      scoredBy: reviewed!.provider, initialConfidence: j ? j.confidence : null, probabilities: j?.probabilities ?? null,
    };
  });
  return { finals, reason: reviewed?.output.reason ?? summarise(finals) };
}


/**
 * Stage 1 for one candidate against one rubric version (form answers only):
 * 1. Exact filters are checked in code. Failing a "reject" filter stops here — no AI call.
 * 2. AI-check filters (free-text answers) and scored criteria go to Jev + OpenAI,
 *    or are reused from an earlier version when unchanged.
 */
export async function scoreCandidate(db: SupabaseClient, job: Job, rubricId: string, candidate: Candidate) {
  const { data: criteria, error } = await db
    .from("rubric_criteria")
    .select("*")
    .eq("rubric_id", rubricId)
    .eq("enabled", true)
    .eq("stage", 1)
    .order("position");
  if (error) throw new Error(error.message);
  const crit = (criteria ?? []) as Criterion[];
  if (!crit.length) throw new Error("The stage-1 rubric has no enabled filters or criteria.");
  const threshold = Number(job.recheck_threshold);

  const exact = crit.filter((c) => c.kind === "rule" && c.rule && !isAiRule(c.rule));
  const aiItems = crit.filter(isAiJudged);

  const ruleFinals = applyRules(exact, candidate.answers);
  const rejectedBy = ruleFinals.find((f) => f.criterion.rule!.action === "reject" && f.decision === "fail");

  let aiFinals: Final[] = [];
  let aiReason: string | null = null;
  if (!rejectedBy && aiItems.length) {
    const scored = (await reuseAiResults(db, candidate.id, rubricId, aiItems)) ?? (await scoreWithAi(job, rubricId, candidate, aiItems));
    aiFinals = scored.finals;
    aiReason = scored.reason;
  }

  const finals = [...ruleFinals, ...aiFinals];
  const agg = aggregate(
    finals.map((f) => ({
      kind: f.criterion.kind, action: f.criterion.rule?.action, weight: f.criterion.weight,
      decision: f.decision, confidence: f.confidence, judgedByAi: f.scoredBy !== "rule",
    })),
    threshold,
    { filterPoints: true }, // passing stage-1 filters counts toward the stage-1 score
  );

  const isFail = (d: Decision) => d === "fail" || d === "not_met";
  const failedFilter =
    rejectedBy ??
    aiFinals.find((f) => (f.criterion.kind === "hard" && f.decision === "fail") || (f.criterion.rule?.action === "reject" && isFail(f.decision)));
  const flagged = finals.filter((f) => f.criterion.kind === "rule" && (f.decision === "unclear" || (f.criterion.rule!.action === "flag" && isFail(f.decision))));
  let reason: string;
  if (rejectedBy) reason = `Fails filter “${rejectedBy.criterion.name}”: ${rejectedBy.evidence} AI screening skipped.`;
  else if (failedFilter) reason = `Fails “${failedFilter.criterion.name}”: ${failedFilter.evidence}`;
  else if (aiReason) reason = aiReason;
  else reason = flagged.length ? "Some filters need a look — see flagged answers." : "Passes every filter.";
  if (!failedFilter && flagged.length && aiReason) {
    reason += ` Check: ${flagged.map((f) => f.criterion.name).join(", ")}.`;
  }

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

/**
 * On demand: evidence for decisions Jev made on its own (no OpenAI call at scoring time).
 * Decisions and confidences don't change; only the evidence text is filled in.
 */
export async function explainJevDecisions(db: SupabaseClient, job: Job, candidate: Candidate, evaluationId: string) {
  const { data: rows, error } = await db
    .from("criterion_results")
    .select("id, criterion_id, decision, confidence, evidence")
    .eq("evaluation_id", evaluationId)
    .eq("scored_by", "jev")
    .eq("evidence", "");
  if (error) throw new Error(error.message);
  if (!rows?.length) return 0;
  const { data: crit } = await db.from("rubric_criteria").select("*").in("id", rows.map((r) => r.criterion_id));
  const byId = new Map(((crit ?? []) as Criterion[]).map((c) => [c.id, c]));
  const items = rows.filter((r) => byId.has(r.criterion_id));
  const { output } = await reviewCandidate({
    jobTitle: job.title,
    rubricId: job.current_rubric_id ?? evaluationId,
    mode: "explain",
    answers: candidate.answers,
    criteria: items.map((r, i) => ({
      key: `c${i}`,
      ...asReview(byId.get(r.criterion_id)!),
      settled: { decision: r.decision, confidence: Number(r.confidence) },
    })),
  });
  const byKey = new Map(output.results.map((r) => [r.key, r.evidence]));
  await Promise.all(
    items.map((r, i) => {
      const evidence = byKey.get(`c${i}`)?.trim();
      return evidence ? db.from("criterion_results").update({ evidence }).eq("id", r.id) : null;
    }),
  );
  return items.length;
}
