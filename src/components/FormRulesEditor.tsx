"use client";

import { useAction } from "./Toast";
import { generateExpectedAnswer } from "@/app/actions/rubric";
import { ACTION_LABEL, OP_LABEL, describeRule, opsFor, validateRule, type FormRule, type RuleAction, type RuleOp, type RuleQuestion } from "@/lib/rules";

export interface RuleRow {
  id: string;
  name: string;
  weight: number;
  enabled: boolean;
  source_constraint: string | null;
  rule: FormRule | null;
  isNew?: boolean;
}

export const ACTION_CHIP: Record<RuleAction, string> = { reject: "bad", flag: "warn", score: "good" };

/** Questions worth a stage-1 check: everything except identity and link questions. */
export function filterableQuestions(questions: RuleQuestion[]) {
  return questions.filter(
    (q) => !q.role && !/\b(name|e-?mail|phone|mobile|resume|\bcv\b|portfolio|github|linkedin|website)\b/i.test(q.title),
  );
}

export const KIND_HINT = (type: string) =>
  type === "paragraph" ? "open-ended → compare with expected answer" : type === "short" ? "free text → AI check" : "exact";

/**
 * A sensible starting check for a question: exact for structured answers, AI check for free text,
 * and "compare with expected answer" (points, never rejects) for open-ended questions.
 */
export function newRule(questions: RuleQuestion[], title?: string): FormRule {
  const q = (title ? questions.find((x) => x.title === title) : undefined) ?? filterableQuestions(questions)[0] ?? questions[0];
  const op = opsFor(q?.type)[0];
  return {
    question: q?.title ?? "", op, value: op === "gte" ? 3 : null, value2: null, options: [], date: null, instruction: "",
    action: op === "ai_expected" ? "score" : "reject",
  };
}

/** Default points for a new check: open-ended answers weigh more than single-field checks. */
export const defaultPoints = (rule: FormRule) => (rule.op === "ai_expected" ? 30 : 10);

/** Editor for one form rule (question, check, values, expected answer, action, points). */
export function RuleEditorRow({ jobId, row, questions, scoreTotal, onPatch, onRemove }: {
  jobId: string;
  row: RuleRow;
  questions: RuleQuestion[];
  scoreTotal: number;
  onPatch: (p: Partial<RuleRow>) => void;
  onRemove: () => void;
}) {
  const { run, pending } = useAction();
  const rule = row.rule!;
  const isExpected = rule.op === "ai_expected";
  const q = questions.find((x) => x.title.trim().toLowerCase() === rule.question.trim().toLowerCase());
  const ops = opsFor(q?.type);
  const setRule = (p: Partial<FormRule>) => onPatch({ rule: { ...rule, ...p } });
  const problem = validateRule(rule, questions);
  const id = row.id;
  const needsNumber = rule.op === "gte" || rule.op === "lte" || rule.op === "between";
  const isAi = rule.op === "ai";
  const needsOptions = ["in", "not_in", "includes_any", "includes_all"].includes(rule.op);
  const needsDate = rule.op === "date_before" || rule.op === "date_after";
  const chosen = new Set((rule.options ?? []).map((o) => o.trim().toLowerCase()));

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "14px 0", display: "grid", gap: 10, opacity: row.enabled ? 1 : 0.6 }}>
      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <label className="switch" style={{ flex: "none" }}>
          <input type="checkbox" checked={row.enabled} onChange={(e) => onPatch({ enabled: e.target.checked })} aria-label={`Use ${row.name}`} />
          <span />
        </label>
        <input className="name" type="text" id={`rn-${id}`} value={row.name} onChange={(e) => onPatch({ name: e.target.value })} aria-label="Rule name" style={{ fontWeight: 600 }} />
        <button className="iconbtn" aria-label={`Remove ${row.name}`} onClick={onRemove}>✕</button>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <select id={`rq-${id}`} aria-label="Form question" value={q?.title ?? rule.question} style={{ flex: "2 1 220px" }}
          onChange={(e) => {
            const nq = questions.find((x) => x.title === e.target.value);
            const nops = opsFor(nq?.type);
            setRule({ question: e.target.value, op: nops.includes(rule.op) ? rule.op : nops[0], options: [] });
          }}>
          {!q && <option value={rule.question}>{rule.question || "Choose a question"}</option>}
          {questions.map((x) => <option key={x.title} value={x.title}>{x.title}</option>)}
        </select>
        <select id={`ro-${id}`} aria-label="Condition" value={rule.op} style={{ flex: "1 1 150px" }}
          onChange={(e) => {
            const op = e.target.value as RuleOp;
            // grading an open-ended answer adds points by default rather than rejecting
            setRule({ op, ...(op === "ai_expected" && rule.action === "reject" ? { action: "score" as const } : {}) });
          }}>
          {ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
        </select>
        {needsNumber && (
          <input type="number" id={`rv-${id}`} aria-label="Value" value={rule.value ?? ""} style={{ flex: "0 1 90px" }}
            onChange={(e) => setRule({ value: e.target.value === "" ? null : Number(e.target.value) })} />
        )}
        {rule.op === "between" && (
          <input type="number" id={`rv2-${id}`} aria-label="Upper value" value={rule.value2 ?? ""} style={{ flex: "0 1 90px" }}
            onChange={(e) => setRule({ value2: e.target.value === "" ? null : Number(e.target.value) })} />
        )}
        {needsDate && (
          <input type="date" id={`rd-${id}`} aria-label="Date" value={rule.date ?? ""} style={{ flex: "0 1 170px" }} onChange={(e) => setRule({ date: e.target.value || null })} />
        )}
      </div>

      {isExpected && (
        <div style={{ display: "grid", gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <label className="f" htmlFor={`rx-${id}`} style={{ margin: 0 }}>Expected answer</label>
            <button type="button" className="pillbtn btn-ghost btn-sm" disabled={pending || !rule.question}
              title="OpenAI writes a sample strong answer to this question, based on the job description"
              onClick={async () => {
                if ((rule.instruction ?? "").trim().length > 20 && !window.confirm("Replace the current expected answer?")) return;
                const r = await run(() => generateExpectedAnswer(jobId, rule.question));
                if (r.ok && "answer" in r && r.answer) setRule({ instruction: r.answer });
              }}>
              {pending ? <><span className="spin" /> Writing…</> : "Generate from JD with AI"}
            </button>
          </div>
          <textarea id={`rx-${id}`} rows={4} value={rule.instruction ?? ""} onChange={(e) => setRule({ instruction: e.target.value })}
            placeholder="What a strong answer from a good-fit candidate would say, e.g. the kind of project, their role, tools used and a measurable outcome."
            style={{ fontSize: 13.5 }} />
          <p className="hint" style={{ margin: 0 }}>
            The AI grades each candidate&apos;s answer against this as meets / partly / not met — on relevance and substance, not length or writing style.
          </p>
        </div>
      )}

      {isAi && (
        <textarea id={`ri-${id}`} rows={2} aria-label="Requirement for the AI to check" value={rule.instruction ?? ""}
          placeholder={/ctc|salary|pay/i.test(rule.question) ? "e.g. Expected CTC at most 25 LPA; treat “negotiable” as unclear" : /city|location/i.test(rule.question) ? "e.g. Based in Bengaluru, or willing to relocate to Bengaluru" : "Describe what an acceptable answer looks like"}
          onChange={(e) => setRule({ instruction: e.target.value })} style={{ fontSize: 13.5 }} />
      )}

      {needsOptions && (
        q?.options.length ? (
          <div className="row" style={{ gap: 12 }}>
            {q.options.map((o) => (
              <label key={o} className="row" style={{ gap: 6, fontSize: 13.5 }}>
                <input type="checkbox" checked={chosen.has(o.trim().toLowerCase())}
                  onChange={(e) => setRule({ options: e.target.checked ? [...(rule.options ?? []), o] : (rule.options ?? []).filter((x) => x.trim().toLowerCase() !== o.trim().toLowerCase()) })} />
                {o}
              </label>
            ))}
          </div>
        ) : (
          <input type="text" id={`rop-${id}`} aria-label="Accepted answers" placeholder="Accepted answers, separated by commas" value={(rule.options ?? []).join(", ")}
            onChange={(e) => setRule({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
        )
      )}

      <div className="row" style={{ gap: 8 }}>
        <select id={`ra-${id}`} aria-label="If not met" value={rule.action} style={{ width: "auto" }} onChange={(e) => setRule({ action: e.target.value as RuleAction })}>
          {(Object.keys(ACTION_LABEL) as RuleAction[]).map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </select>
        <div className="wt" style={{ flex: "1 1 220px" }} title="Share of the stage-1 score earned by passing this filter">
          <span className="hint" style={{ margin: 0, whiteSpace: "nowrap" }}>Points when met</span>
          <input type="range" min={0} max={50} step={5} value={row.weight} onChange={(e) => onPatch({ weight: Number(e.target.value) })} aria-label={`Points for ${row.name}`} />
          <span className="mono">{scoreTotal && row.enabled ? Math.round((row.weight / scoreTotal) * 100) : 0}%</span>
        </div>
      </div>

      {problem ? <p className="error-text" style={{ margin: 0 }}>{problem}</p> : <p className="hint" style={{ margin: 0 }}>{describeRule(rule)} → {ACTION_LABEL[rule.action].toLowerCase()}.</p>}
      {row.source_constraint && <p className="hint" style={{ margin: 0 }}>From your constraint: “{row.source_constraint}”</p>}
    </div>
  );
}
