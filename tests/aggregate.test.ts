import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../src/lib/aggregate.ts";

const soft = (weight: number, decision: string, confidence = 0.9) => ({ kind: "soft" as const, weight, decision: decision as never, confidence });
const hard = (decision: string, confidence = 0.9) => ({ kind: "hard" as const, weight: 0, decision: decision as never, confidence });

test("weighted score counts borderline as half", () => {
  const r = aggregate([soft(50, "meets"), soft(30, "borderline"), soft(20, "not_met")], 0.7);
  assert.equal(r.score, 65);
  assert.equal(r.disqualified, false);
});

test("hard filter fail disqualifies without changing the score", () => {
  const r = aggregate([soft(100, "meets"), hard("fail")], 0.7);
  assert.equal(r.score, 100);
  assert.equal(r.disqualified, true);
  assert.equal(r.needsReview, false);
});

test("low confidence or unclear hard filter needs review", () => {
  assert.equal(aggregate([soft(100, "meets", 0.5)], 0.7).needsReview, true);
  assert.equal(aggregate([soft(100, "meets"), hard("unclear")], 0.7).needsReview, true);
  assert.equal(aggregate([soft(100, "meets")], 0.7).needsReview, false);
});

test("no soft weight scores zero", () => {
  assert.equal(aggregate([hard("pass")], 0.7).score, 0);
});

const rule = (action: "reject" | "flag" | "score", decision: string, weight = 0) =>
  ({ kind: "rule" as const, action, weight, decision: decision as never, confidence: decision === "unclear" ? 0.5 : 1 });

test("a failed reject-rule disqualifies; an unclear one only flags for review", () => {
  assert.equal(aggregate([soft(100, "meets"), rule("reject", "fail")], 0.7).disqualified, true);
  const unclear = aggregate([soft(100, "meets"), rule("reject", "unclear")], 0.7);
  assert.equal(unclear.disqualified, false);
  assert.equal(unclear.needsReview, true);
});

test("a failed flag-rule marks for review without rejecting", () => {
  const r = aggregate([soft(100, "meets"), rule("flag", "fail")], 0.7);
  assert.equal(r.disqualified, false);
  assert.equal(r.needsReview, true);
  assert.equal(r.score, 100);
});

test("score-rules add weighted points; rules don't lower AI confidence", () => {
  const r = aggregate([soft(50, "meets"), rule("score", "fail", 50)], 0.7);
  assert.equal(r.score, 50);
  assert.equal(r.confidence, 0.9);
  assert.equal(aggregate([soft(50, "meets"), rule("score", "pass", 50)], 0.7).score, 100);
});
