import type { Decision } from "./types";

/** Plain-language ranking reason built from the decisions, used when no AI summary was written. */
export function summarise(finals: { criterion: { name: string }; decision: Decision }[]) {
  const names = (ds: Decision[]) => finals.filter((f) => ds.includes(f.decision)).map((f) => f.criterion.name);
  const list = (xs: string[]) => (xs.length > 3 ? `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more` : xs.join(", "));
  const strong = names(["meets", "pass"]);
  const partial = names(["borderline", "unclear"]);
  const weak = names(["not_met", "fail"]);
  const parts = [
    strong.length && `strong on ${list(strong)}`,
    partial.length && `partly on ${list(partial)}`,
    weak.length && `falls short on ${list(weak)}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return "Screened on the form answers.";
  const s = parts.join("; ");
  return `${s[0].toUpperCase()}${s.slice(1)}.`;
}
