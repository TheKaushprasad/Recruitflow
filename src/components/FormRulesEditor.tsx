"use client";

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

const ACTION_CHIP: Record<RuleAction, string> = { reject: "bad", flag: "warn", score: "good" };

export function newRule(questions: RuleQuestion[]): FormRule {
  const q = questions.find((x) => /experience/i.test(x.title)) ?? questions[0];
  const ops = opsFor(q?.type);
  return { question: q?.title ?? "", op: ops[0], value: ops[0] === "gte" ? 3 : null, value2: null, options: [], date: null, action: "reject" };
}

export function FormRulesEditor({ rows, editable, questions, scoreTotal, onPatch, onRemove, onAdd }: {
  rows: RuleRow[];
  editable: boolean;
  questions: RuleQuestion[];
  /** total weight of scored items, to show a score-rule's share */
  scoreTotal: number;
  onPatch: (id: string, p: Partial<RuleRow>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="panel">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h3>Form rules</h3>
        <span className="muted" style={{ fontSize: 13 }}>Checked exactly against form answers — no AI</span>
      </div>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        Applied the moment a response arrives, before any AI scoring. Blank or unreadable answers are flagged for review, never rejected.
      </p>

      {rows.length === 0 && (
        <p className="muted" style={{ fontSize: 14 }}>
          No form rules. {editable ? "Add one to screen on a form answer, e.g. years of experience at least 3." : "Start a new version to add some."}
        </p>
      )}

      {rows.map((r) =>
        editable ? (
          <RuleEditorRow key={r.id} row={r} questions={questions} scoreTotal={scoreTotal} onPatch={(p) => onPatch(r.id, p)} onRemove={() => onRemove(r.id)} />
        ) : (
          <div className="hard" key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
            <span className={`chip ${r.rule ? ACTION_CHIP[r.rule.action] : "neutral"}`} style={{ flex: "none" }}>
              {r.rule?.action === "reject" ? "Reject" : r.rule?.action === "flag" ? "Flag" : "Score"}
            </span>
            <div className="x">
              <b>{r.name}</b>
              {r.rule && <div className="src">{describeRule(r.rule)}{r.rule.action === "score" && scoreTotal ? ` · ${Math.round((r.weight / scoreTotal) * 100)}% of score` : ""}</div>}
              {r.source_constraint && <div className="src">From your constraint: “{r.source_constraint}”</div>}
              {!r.enabled && <div className="src">Not used</div>}
            </div>
          </div>
        ),
      )}

      {editable && (
        <button className="pillbtn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={onAdd} disabled={!questions.length}
          title={!questions.length ? "Add form questions in Job setup first" : undefined}>
          + Add form rule
        </button>
      )}
    </div>
  );
}

function RuleEditorRow({ row, questions, scoreTotal, onPatch, onRemove }: {
  row: RuleRow;
  questions: RuleQuestion[];
  scoreTotal: number;
  onPatch: (p: Partial<RuleRow>) => void;
  onRemove: () => void;
}) {
  const rule = row.rule!;
  const q = questions.find((x) => x.title.trim().toLowerCase() === rule.question.trim().toLowerCase());
  const ops = opsFor(q?.type);
  const setRule = (p: Partial<FormRule>) => onPatch({ rule: { ...rule, ...p } });
  const problem = validateRule(rule, questions);
  const id = row.id;
  const needsNumber = rule.op === "gte" || rule.op === "lte" || rule.op === "between";
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
        <select id={`ro-${id}`} aria-label="Condition" value={rule.op} style={{ flex: "1 1 150px" }} onChange={(e) => setRule({ op: e.target.value as RuleOp })}>
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
        {rule.action === "score" && (
          <div className="wt" style={{ flex: "1 1 200px" }}>
            <input type="range" min={0} max={50} step={5} value={row.weight} onChange={(e) => onPatch({ weight: Number(e.target.value) })} aria-label={`Weight for ${row.name}`} />
            <span className="mono">{scoreTotal && row.enabled ? Math.round((row.weight / scoreTotal) * 100) : 0}%</span>
          </div>
        )}
      </div>

      {problem ? <p className="error-text" style={{ margin: 0 }}>{problem}</p> : <p className="hint" style={{ margin: 0 }}>{describeRule(rule)} → {ACTION_LABEL[rule.action].toLowerCase()}.</p>}
      {row.source_constraint && <p className="hint" style={{ margin: 0 }}>From your constraint: “{row.source_constraint}”</p>}
    </div>
  );
}
