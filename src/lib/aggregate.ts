import type { Decision } from "./types";

const SOFT_VALUE: Record<string, number> = { meets: 1, borderline: 0.5, not_met: 0 };

/** Pure aggregation — shared by the pipeline and tests. */
export function aggregate(
  results: { kind: "hard" | "soft"; weight: number; decision: Decision; confidence: number }[],
  threshold: number,
) {
  const soft = results.filter((r) => r.kind === "soft");
  const totalW = soft.reduce((a, r) => a + r.weight, 0);
  const score = totalW
    ? Math.round((soft.reduce((a, r) => a + r.weight * (SOFT_VALUE[r.decision] ?? 0), 0) / totalW) * 100)
    : 0;
  const hard = results.filter((r) => r.kind === "hard");
  const disqualified = hard.some((r) => r.decision === "fail");
  const confidence = results.length ? results.reduce((a, r) => a + r.confidence, 0) / results.length : 0;
  const needsReview =
    !disqualified && (results.some((r) => r.confidence < threshold) || hard.some((r) => r.decision === "unclear"));
  return { score, disqualified, confidence, needsReview };
}
