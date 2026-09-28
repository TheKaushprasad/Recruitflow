import { aggregate } from "../aggregate";
import { answerFor, checkRule } from "../rules";
import { summarise } from "../summary";
import type { Decision, EvidenceSource } from "../types";
import { DEMO_CANDIDATES, DEMO_RULES, DEMO_STAGE2 } from "./fixture";

/**
 * Scores the sample candidates exactly like the live app (exact rules in code, weighted share met,
 * reject filters stop screening). Used to seed guest workspaces and to draw the landing page,
 * so both always show the same numbers.
 */

export const DEMO_THRESHOLD = 0.7;
type DemoCandidate = (typeof DEMO_CANDIDATES)[number];

export function demoAnswers(c: DemoCandidate) {
  return [
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
}

export interface DemoFinal {
  r: (typeof DEMO_RULES)[number];
  decision: Decision;
  confidence: number;
  evidence: string;
  by: "rule" | "jev" | "openai";
  init: number | null;
}

export function scoreStage1(c: DemoCandidate) {
  const answers = demoAnswers(c);
  const finals: DemoFinal[] = DEMO_RULES.map((r) => {
    if (r.rule.op === "in") {
      const chk = checkRule(r.rule, answerFor(r.rule, answers));
      return { r, decision: chk.outcome as Decision, confidence: chk.outcome === "unclear" ? 0.5 : 1, evidence: chk.detail, by: "rule", init: null };
    }
    const [decision, confidence, evidence, by = "jev", init = null] = c.ai[r.key as keyof typeof c.ai];
    return { r, decision, confidence, evidence, by, init };
  });
  const agg = aggregate(
    finals.map((f) => ({ kind: "rule" as const, action: f.r.rule.action, weight: f.r.weight, decision: f.decision, confidence: f.confidence, judgedByAi: f.by !== "rule" })),
    DEMO_THRESHOLD, { filterPoints: true },
  );
  const rejected = finals.find((f) => f.r.rule.action === "reject" && f.decision === "fail");
  const reason = rejected
    ? `Fails filter “${rejected.r.name}”: ${rejected.evidence} AI screening skipped.`
    : c.reason || summarise(finals.map((f) => ({ criterion: { name: f.r.name }, decision: f.decision })));
  // A rejecting filter stops screening before any AI call, as in the live app.
  const kept = rejected ? finals.filter((f) => f.by === "rule") : finals;
  return { finals: kept, agg, rejected: !!rejected, score: rejected ? 0 : agg.score, reason };
}

export interface DemoDeepResult {
  name: string;
  kind: "rule" | "hard" | "soft";
  action?: "reject" | "flag" | "score";
  weight: number;
  decision: Decision;
  confidence: number;
  evidence: string;
  sources: EvidenceSource[];
}

export function scoreStage2(c: DemoCandidate, stage1: DemoFinal[]) {
  if (!c.stage2) return null;
  const carried: DemoDeepResult[] = stage1
    .filter((f) => f.r.rule.action !== "score")
    .map((f) => ({ name: f.r.name, kind: "rule", action: f.r.rule.action, weight: 0, decision: f.decision, confidence: f.confidence, evidence: f.evidence || "Checked on the form answer.", sources: ["form"] }));
  const judged: DemoDeepResult[] = DEMO_STAGE2.map((d) => {
    const [decision, confidence, evidence, sources] = c.stage2!.results[d.key];
    return { name: d.name, kind: d.kind, weight: d.weight, decision, confidence, evidence, sources };
  });
  const results = [...carried, ...judged];
  const agg = aggregate(results.map((r) => ({ kind: r.kind, action: r.action, weight: r.weight, decision: r.decision, confidence: r.confidence })), DEMO_THRESHOLD);
  return { results, agg };
}

const RULE_TOTAL = DEMO_RULES.reduce((a, r) => a + r.weight, 0);
/** A rule's share of the stage-1 score, in whole percent. */
export const shareOfRule = (weight: number) => Math.round((weight / RULE_TOTAL) * 100);
