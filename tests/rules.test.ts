import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFor, checkRule, describeRule, parseLakhs, parseRange, validateRule, type FormRule } from "../src/lib/rules.ts";

const r = (p: Partial<FormRule>): FormRule => ({ question: "Years of experience", op: "gte", value: 3, action: "reject", ...p });

test("parseRange reads numbers, words, ranges and open ends", () => {
  assert.deepEqual(parseRange("3"), [3, 3]);
  assert.deepEqual(parseRange("3.5 years"), [3.5, 3.5]);
  assert.deepEqual(parseRange("three years"), [3, 3]);
  assert.deepEqual(parseRange("3-5 years"), [3, 5]);
  assert.deepEqual(parseRange("3–5 years"), [3, 5]);
  assert.deepEqual(parseRange("8+ years"), [8, Infinity]);
  assert.equal(parseRange("less than 1 year")![0], 0);
  assert.ok(parseRange("less than 1 year")![1] < 1);
  assert.ok(parseRange("over 10")![0] > 10);
  assert.equal(parseRange("a few"), null);
});

test("at-least rules: pass, fail, and ranges that straddle the limit are unclear", () => {
  assert.equal(checkRule(r({}), "4 years").outcome, "pass");
  assert.equal(checkRule(r({}), "3–5 years").outcome, "pass");
  assert.equal(checkRule(r({}), "8+ years").outcome, "pass");
  assert.equal(checkRule(r({}), "1–3 years").outcome, "unclear"); // could be exactly 3
  assert.equal(checkRule(r({}), "Less than 1 year").outcome, "fail");
  assert.equal(checkRule(r({}), "2").outcome, "fail");
  assert.match(checkRule(r({}), "2").detail, /needs at least 3/);
});

test("blank or unreadable answers are unclear, never a fail", () => {
  assert.equal(checkRule(r({}), "").outcome, "unclear");
  assert.equal(checkRule(r({}), null).outcome, "unclear");
  assert.equal(checkRule(r({}), "quite a lot").outcome, "unclear");
  assert.equal(checkRule(r({ op: "answered" }), "").outcome, "fail");
});

test("at-most and between", () => {
  assert.equal(checkRule(r({ op: "lte", value: 60 }), "45 days").outcome, "pass");
  assert.equal(checkRule(r({ op: "lte", value: 60 }), "90 days or more").outcome, "fail");
  assert.equal(checkRule(r({ op: "between", value: 2, value2: 6 }), "3-5").outcome, "pass");
  assert.equal(checkRule(r({ op: "between", value: 2, value2: 6 }), "8+").outcome, "fail");
});

test("choice and checkbox rules are case/space-insensitive", () => {
  const notice = r({ question: "Notice period", op: "in", options: ["Immediate", "15 days", "30 days", "45 days", "60 days"] });
  assert.equal(checkRule(notice, "30 days").outcome, "pass");
  assert.equal(checkRule(notice, "  immediate ").outcome, "pass");
  assert.equal(checkRule(notice, "90 days or more").outcome, "fail");
  assert.equal(checkRule(r({ op: "not_in", options: ["No"] }), "Yes").outcome, "pass");
  const skills = r({ question: "Skills", op: "includes_any", options: ["SQL", "Python"] });
  assert.equal(checkRule(skills, "Excel, SQL").outcome, "pass");
  assert.equal(checkRule(skills, "Excel").outcome, "fail");
  assert.equal(checkRule(r({ question: "Skills", op: "includes_all", options: ["SQL", "Python"] }), "SQL, Python, R").outcome, "pass");
});

test("date rules", () => {
  const join = r({ question: "Earliest joining date", op: "date_before", date: "2026-12-01" });
  assert.equal(checkRule(join, "2026-11-15").outcome, "pass");
  assert.equal(checkRule(join, "2027-01-10").outcome, "fail");
  assert.equal(checkRule(join, "soon").outcome, "unclear");
});

test("validateRule catches unknown questions, bad options and age proxies", () => {
  const qs = [
    { title: "Years of experience", type: "dropdown", options: ["Less than 1 year", "1–2 years", "3–5 years"] },
    { title: "Graduation year", type: "short", options: [] },
    { title: "Notice period", type: "dropdown", options: ["Immediate", "30 days"] },
  ];
  assert.equal(validateRule(r({}), qs), null);
  assert.match(validateRule(r({ question: "Salary" }), qs)!, /isn't a question/);
  assert.match(validateRule(r({ op: "lte", value: 5 }), qs)!, /age filter/);
  assert.match(validateRule(r({ question: "Graduation year", op: "gte", value: 2015 }), qs)!, /age filter/);
  assert.match(validateRule(r({ question: "Notice period", op: "in", options: ["90 days"] }), qs)!, /isn't one of/);
  assert.equal(validateRule(r({ question: "Notice period", op: "in", options: ["immediate", "30 days"] }), qs), null);
  assert.match(validateRule(r({ value: null }), qs)!, /Enter a number/);
});

test("parseLakhs reads Indian pay figures as LPA", () => {
  assert.deepEqual(parseLakhs("12 LPA"), [12, 12]);
  assert.deepEqual(parseLakhs("12L"), [12, 12]);
  assert.deepEqual(parseLakhs("₹15 lakhs"), [15, 15]);
  assert.deepEqual(parseLakhs("12,00,000"), [12, 12]);
  assert.deepEqual(parseLakhs("1.2 Cr"), [120, 120]);
  assert.deepEqual(parseLakhs("12-15 LPA"), [12, 15]);
  assert.equal(parseLakhs("negotiable"), null);
});

test("CTC rules compare in lakhs; AI filters need a written requirement", () => {
  const ctc = r({ question: "Expected CTC", op: "lte", value: 25 });
  assert.equal(checkRule(ctc, "18 LPA").outcome, "pass");
  assert.equal(checkRule(ctc, "30,00,000").outcome, "fail");
  assert.equal(checkRule(ctc, "negotiable").outcome, "unclear");
  const qs = [{ title: "Current city", type: "short", options: [] }, { title: "Years of experience", type: "short", options: [] }];
  assert.match(validateRule(r({ question: "Current city", op: "ai", instruction: "" }), qs)!, /Write the requirement/);
  assert.equal(validateRule(r({ question: "Current city", op: "ai", instruction: "In Bengaluru or willing to relocate" }), qs), null);
  assert.match(validateRule(r({ question: "Years of experience", op: "ai", instruction: "at most 5 years" }), qs)!, /age filter/);
  assert.match(describeRule(r({ question: "Current city", op: "ai", instruction: "In Bengaluru" })), /AI checks: In Bengaluru/);
});

test("open-ended questions default to 'compare with expected answer', which needs an expected answer", () => {
  const qs = [{ title: "Tell us about the most relevant project you've worked on", type: "paragraph", options: [] }];
  const base = r({ question: qs[0].title, op: "ai_expected", action: "score" });
  assert.match(validateRule({ ...base, instruction: "" }, qs)!, /expected answer/);
  assert.equal(validateRule({ ...base, instruction: "I led an LLM evaluation platform for 3 product teams, owning requirements and metrics." }, qs), null);
  assert.match(describeRule(base), /compares with the expected answer/);
});

test("answerFor matches titles loosely; describeRule reads naturally", () => {
  const answers = [{ question: "Years  of Experience", answer: "4" }];
  assert.equal(answerFor(r({}), answers), "4");
  assert.equal(describeRule(r({})), "“Years of experience” is at least 3");
  assert.equal(describeRule(r({ op: "in", options: ["Yes"] })), "“Years of experience” is one of: Yes");
});
