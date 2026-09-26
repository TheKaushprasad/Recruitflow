// Form rules: HR-defined checks on form answers, applied exactly in code (no AI).
// Pure module — used by stage 1, stage 2, the rubric editor and tests.

export type RuleOp =
  | "gte" // number at least
  | "lte" // number at most
  | "between" // number between value and value2 (inclusive)
  | "in" // answer is one of options
  | "not_in" // answer is none of options
  | "includes_any" // checkbox answer includes any of options
  | "includes_all" // checkbox answer includes all options
  | "date_before" // date on or before
  | "date_after" // date on or after
  | "answered"; // any non-blank answer

export type RuleAction = "reject" | "flag" | "score";

export interface FormRule {
  question: string; // question title, as it appears in responses
  op: RuleOp;
  value?: number | null;
  value2?: number | null;
  options?: string[] | null;
  date?: string | null; // YYYY-MM-DD
  action: RuleAction;
}

export type RuleOutcome = "pass" | "fail" | "unclear";

export interface RuleCheck {
  outcome: RuleOutcome;
  /** Plain-language explanation shown as evidence, e.g. 'Answered "1–3 years"; needs at least 3.' */
  detail: string;
  answer: string | null;
}

export const OP_LABEL: Record<RuleOp, string> = {
  gte: "is at least",
  lte: "is at most",
  between: "is between",
  in: "is one of",
  not_in: "is not one of",
  includes_any: "includes any of",
  includes_all: "includes all of",
  date_before: "is on or before",
  date_after: "is on or after",
  answered: "is answered",
};

export const ACTION_LABEL: Record<RuleAction, string> = {
  reject: "Reject if not met",
  flag: "Flag for review if not met",
  score: "Add to score",
};

const WORDS: Record<string, number> = {
  zero: 0, none: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/**
 * Reads a number or range out of an answer: "3", "3.5 years", "three", "3+", "8+ years",
 * "3-5", "3–5 years", "less than 1 year", "<1", "over 10". Returns [low, high] (inclusive
 * bounds; Infinity for open-ended), or null when no number can be found.
 */
export function parseRange(raw: string): [number, number] | null {
  const s = raw.toLowerCase().replace(/,/g, "").replace(/[–—]/g, "-").trim();
  if (!s) return null;
  const num = (x: string) => (x in WORDS ? WORDS[x] : Number(x));
  const N = "(\\d+(?:\\.\\d+)?|" + Object.keys(WORDS).join("|") + ")";

  let m = s.match(new RegExp(`(?:less than|under|below|<)\\s*${N}`));
  if (m) return [0, num(m[1]) - 1e-9];
  m = s.match(new RegExp(`(?:more than|over|above|>)\\s*${N}`));
  if (m) return [num(m[1]) + 1e-9, Infinity];
  m = s.match(new RegExp(`${N}\\s*(?:\\+|or more|and above|plus)`));
  if (m) return [num(m[1]), Infinity];
  m = s.match(new RegExp(`${N}\\s*(?:-|to)\\s*${N}`));
  if (m) {
    const a = num(m[1]), b = num(m[2]);
    return [Math.min(a, b), Math.max(a, b)];
  }
  m = s.match(new RegExp(`\\b${N}\\b`));
  if (m) {
    const v = num(m[1]);
    return [v, v];
  }
  return null;
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
const splitMulti = (v: string) => v.split(/\s*[,;\n]\s*/).map(norm).filter(Boolean);
const fmtN = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function parseDate(v: string): number | null {
  const iso = v.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  const t = iso ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3]) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/** Applies one rule to a candidate's answer. Blank or unreadable answers are "unclear", never "fail". */
export function checkRule(rule: FormRule, answer: string | null | undefined): RuleCheck {
  const a = (answer ?? "").trim();
  const said = a ? `Answered “${a.length > 80 ? a.slice(0, 77) + "…" : a}”` : "No answer";
  if (!a) {
    return { outcome: rule.op === "answered" ? "fail" : "unclear", detail: `${said} to “${rule.question}”.`, answer: null };
  }
  if (rule.op === "answered") return { outcome: "pass", detail: `${said}.`, answer: a };

  if (rule.op === "gte" || rule.op === "lte" || rule.op === "between") {
    const r = parseRange(a);
    if (!r) return { outcome: "unclear", detail: `${said} — no number could be read from it.`, answer: a };
    const [lo, hi] = r;
    const v = Number(rule.value ?? 0);
    const v2 = Number(rule.value2 ?? v);
    let outcome: RuleOutcome;
    let need: string;
    if (rule.op === "gte") {
      need = `at least ${fmtN(v)}`;
      outcome = lo >= v ? "pass" : hi < v ? "fail" : "unclear";
    } else if (rule.op === "lte") {
      need = `at most ${fmtN(v)}`;
      outcome = hi <= v ? "pass" : lo > v ? "fail" : "unclear";
    } else {
      const [min, max] = [Math.min(v, v2), Math.max(v, v2)];
      need = `between ${fmtN(min)} and ${fmtN(max)}`;
      outcome = lo >= min && hi <= max ? "pass" : hi < min || lo > max ? "fail" : "unclear";
    }
    const why = outcome === "unclear" ? " — the answer spans the limit, so it needs a look" : "";
    return { outcome, detail: `${said}; needs ${need}${why}.`, answer: a };
  }

  if (rule.op === "date_before" || rule.op === "date_after") {
    const t = parseDate(a);
    const limit = rule.date ? parseDate(rule.date) : null;
    if (t == null || limit == null) return { outcome: "unclear", detail: `${said} — not a date that could be read.`, answer: a };
    const ok = rule.op === "date_before" ? t <= limit : t >= limit;
    return { outcome: ok ? "pass" : "fail", detail: `${said}; needs ${rule.op === "date_before" ? "on or before" : "on or after"} ${rule.date}.`, answer: a };
  }

  const opts = (rule.options ?? []).map(norm).filter(Boolean);
  const list = (rule.options ?? []).join(", ");
  if (!opts.length) return { outcome: "unclear", detail: "This rule has no options set.", answer: a };
  if (rule.op === "in" || rule.op === "not_in") {
    const hit = opts.includes(norm(a));
    const ok = rule.op === "in" ? hit : !hit;
    return { outcome: ok ? "pass" : "fail", detail: `${said}; needs ${rule.op === "in" ? "one of" : "none of"}: ${list}.`, answer: a };
  }
  const chosen = splitMulti(a);
  const ok = rule.op === "includes_any" ? opts.some((o) => chosen.includes(o)) : opts.every((o) => chosen.includes(o));
  return { outcome: ok ? "pass" : "fail", detail: `${said}; needs ${rule.op === "includes_any" ? "any of" : "all of"}: ${list}.`, answer: a };
}

/** Finds the answer to a rule's question (exact title, then case/space-insensitive). */
export function answerFor(rule: FormRule, answers: { question: string; answer: string }[]) {
  return (answers.find((x) => x.question === rule.question) ?? answers.find((x) => norm(x.question) === norm(rule.question)))?.answer ?? null;
}

/** e.g. 'Years of experience is at least 3 → Reject if not met' */
export function describeRule(rule: FormRule) {
  let target = "";
  if (rule.op === "gte" || rule.op === "lte") target = ` ${fmtN(Number(rule.value ?? 0))}`;
  else if (rule.op === "between") target = ` ${fmtN(Number(rule.value ?? 0))} and ${fmtN(Number(rule.value2 ?? 0))}`;
  else if (rule.op === "date_before" || rule.op === "date_after") target = ` ${rule.date ?? "?"}`;
  else if (rule.op !== "answered") target = `: ${(rule.options ?? []).join(", ")}`;
  return `“${rule.question}” ${OP_LABEL[rule.op]}${target}`;
}

/** Which operators make sense for a question type. */
export function opsFor(type: string | null | undefined): RuleOp[] {
  switch (type) {
    case "dropdown":
    case "choice":
      return ["in", "not_in", "gte", "lte", "between", "answered"];
    case "checkbox":
      return ["includes_any", "includes_all", "answered"];
    case "date":
      return ["date_before", "date_after", "answered"];
    default:
      return ["gte", "lte", "between", "in", "not_in", "answered"];
  }
}

export interface RuleQuestion {
  title: string;
  type: string;
  options: string[];
}

const AGE_PROXY = /\b(age|date of birth|dob|birth ?year|year of birth|graduat\w*|passing year|year of passing)\b/i;
const EXPERIENCE = /experience|\byears?\b|\byrs?\b/i;

/**
 * Checks a rule is well-formed and fair before it's saved. Returns a plain-language
 * problem, or null when it's fine.
 */
export function validateRule(rule: FormRule, questions: RuleQuestion[]): string | null {
  if (!rule.question?.trim()) return "Pick the form question this rule checks.";
  const q = questions.find((x) => norm(x.title) === norm(rule.question));
  if (!q) return `“${rule.question}” isn't a question on this job's form.`;
  if (AGE_PROXY.test(rule.question)) return `Rules on “${rule.question}” aren't allowed — it can act as an age filter.`;
  if ((rule.op === "lte" || rule.op === "between") && EXPERIENCE.test(rule.question)) {
    return "A maximum on years of experience acts as an age filter. Use “at least” instead.";
  }
  if (!["reject", "flag", "score"].includes(rule.action)) return "Choose what happens when the rule isn't met.";
  if (["gte", "lte", "between"].includes(rule.op)) {
    if (rule.value == null || !Number.isFinite(Number(rule.value))) return "Enter a number for this rule.";
    if (rule.op === "between" && (rule.value2 == null || !Number.isFinite(Number(rule.value2)))) return "Enter both numbers for “between”.";
  }
  if (rule.op === "date_before" || rule.op === "date_after") {
    if (!rule.date || !/^\d{4}-\d{2}-\d{2}$/.test(rule.date)) return "Pick a date for this rule.";
  }
  if (["in", "not_in", "includes_any", "includes_all"].includes(rule.op)) {
    const opts = (rule.options ?? []).map((o) => o.trim()).filter(Boolean);
    if (!opts.length) return "Choose at least one option.";
    if (q.options.length) {
      const known = new Set(q.options.map(norm));
      const unknown = opts.filter((o) => !known.has(norm(o)));
      if (unknown.length) return `“${unknown[0]}” isn't one of the question's options.`;
    }
  }
  return null;
}

/** Map a rule outcome to the decision stored with scores. */
export function ruleDecision(outcome: RuleOutcome) {
  return outcome === "pass" ? "pass" : outcome === "fail" ? "fail" : "unclear";
}
