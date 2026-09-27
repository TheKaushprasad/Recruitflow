import type { Decision } from "./types";

// meets / borderline / not_met: graded items (AI criteria, open-ended answers vs. expected answer)
// pass / unclear / fail: filters
const VALUE: Record<string, number> = { meets: 1, borderline: 0.5, not_met: 0, pass: 1, unclear: 0.5, fail: 0 };
const failed = (d: Decision) => d === "fail" || d === "not_met";

export interface AggregateInput {
  kind: "hard" | "soft" | "rule";
  /** rules only: what failing it does */
  action?: "reject" | "flag" | "score";
  weight: number;
  decision: Decision;
  confidence: number;
  /** rules judged by the AI (free-text / open-ended answers) count toward AI confidence */
  judgedByAi?: boolean;
}

/**
 * Pure aggregation — shared by stage 1, stage 2 and tests.
 * - soft criteria and "score" rules make up the weighted score (borderline / unclear count half)
 * - with `filterPoints` (stage 1), every filter adds its weight when passed, so passing the basics
 *   counts even when the open-ended answers are thin
 * - failing an AI hard filter or a "reject" rule disqualifies
 * - low AI confidence, an unclear hard filter, a failed "flag" rule, or any unclear rule
 *   (blank or unreadable answer) marks the candidate for review — never an automatic reject
 * - confidence averages the AI judgements only (exact rules are certain). `aiJudged` says whether there were any.
 */
export function aggregate(results: AggregateInput[], threshold: number, opts: { filterPoints?: boolean } = {}) {
  const scored = results.filter(
    (r) => r.kind === "soft" || (r.kind === "rule" && (r.action === "score" || (opts.filterPoints && r.weight > 0))),
  );
  const totalW = scored.reduce((a, r) => a + r.weight, 0);
  const score = totalW ? Math.round((scored.reduce((a, r) => a + r.weight * (VALUE[r.decision] ?? 0), 0) / totalW) * 100) : 0;

  const hard = results.filter((r) => r.kind === "hard");
  const rules = results.filter((r) => r.kind === "rule");
  const disqualified = hard.some((r) => r.decision === "fail") || rules.some((r) => r.action === "reject" && failed(r.decision));

  const ai = results.filter((r) => r.kind !== "rule" || r.judgedByAi);
  const confidence = ai.length ? ai.reduce((a, r) => a + r.confidence, 0) / ai.length : 1;
  const needsReview =
    !disqualified &&
    (ai.some((r) => r.confidence < threshold) ||
      hard.some((r) => r.decision === "unclear") ||
      rules.some((r) => r.decision === "unclear" || (r.action === "flag" && failed(r.decision))));
  return { score, disqualified, confidence, needsReview, aiJudged: ai.length > 0 };
}
