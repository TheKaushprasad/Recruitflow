"use client";

import { useEffect } from "react";
import { Icon } from "@/components/Icon";
import { ACTION_CHIP, KIND_HINT, RuleEditorRow, filterableQuestions } from "@/components/FormRulesEditor";
import { describeRule, isAiRule, isExpectedAnswerRule, validateRule, type FormRule, type RuleQuestion } from "@/lib/rules";
import type { Criterion } from "@/lib/types";

export type C = Pick<Criterion, "id" | "kind" | "name" | "description" | "weight" | "enabled" | "source_constraint" | "bias_flag" | "rule" | "stage"> & { isNew?: boolean };

/** Share of the stage score an item earns when met (0 when it doesn't score). */
export const shareOf = (c: C, total: number) => (total && c.enabled && c.weight > 0 ? Math.round((c.weight / total) * 100) : 0);

const checkType = (r: FormRule) =>
  isExpectedAnswerRule(r) ? { label: "AI-graded answer", tone: "lime", tip: "AI grades the answer against your expected answer" }
  : isAiRule(r) ? { label: "AI check", tone: "sky", tip: "AI decides pass / fail against the requirement you wrote" }
  : { label: "Exact", tone: "neutral", tip: "Checked exactly in code" };

const ACTION_SHORT = { reject: "Reject", flag: "Flag for review", score: "Points only" } as const;

/** Stage-1 rules as a scannable table; a row opens the full editor. */
export function RulesTable({ rows, questions, total, editable, onOpen, onToggle, onAddFor }: {
  rows: C[];
  questions: RuleQuestion[];
  total: number;
  editable: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  onAddFor: (question: string) => void;
}) {
  const covered = new Set(rows.map((r) => r.rule?.question.trim().toLowerCase()));
  const unchecked = filterableQuestions(questions).filter((q) => !covered.has(q.title.trim().toLowerCase()));
  return (
    <>
      <div className="rtable-wrap">
        <table className="rtable">
          <colgroup><col className="w-on" /><col /><col className="w-type" /><col /><col className="w-act" /><col className="w-share" /><col className="w-go" /></colgroup>
          <thead>
            <tr><th><span className="sr-only">On</span></th><th>Rule</th><th>Check</th><th>Condition</th><th>If not met</th><th className="num">Share</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const r = c.rule!;
              const t = checkType(r);
              const problem = validateRule(r, questions);
              return (
                <tr key={c.id} className={c.enabled ? "" : "off"} onClick={(e) => { if (!(e.target as HTMLElement).closest("input,label")) onOpen(c.id); }}>
                  <td>
                    <label className="switch sm" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={c.enabled} disabled={!editable} onChange={(e) => onToggle(c.id, e.target.checked)} aria-label={`Use ${c.name}`} />
                      <span />
                    </label>
                  </td>
                  <td>
                    <b className="rt-name">{c.name}{c.bias_flag && <span className="bias-mark" title={c.bias_flag}> ⚑</span>}</b>
                    <span className="rt-sub">{r.question}</span>
                  </td>
                  <td><span className={`chip ${t.tone}`} title={t.tip}>{t.label}</span></td>
                  <td>
                    {problem ? <span className="error-text rt-cond">{problem}</span> : <span className="rt-cond">{isExpectedAnswerRule(r) ? `vs expected answer: ${r.instruction || "—"}` : describeRule(r)}</span>}
                  </td>
                  <td><span className={`chip ${ACTION_CHIP[r.action]}`}>{ACTION_SHORT[r.action]}</span></td>
                  <td className="num mono">{shareOf(c, total)}%</td>
                  <td><span className="rt-go" aria-hidden="true">›</span></td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr className="empty-row"><td colSpan={7}>No rules yet. {editable ? "Add one below, or generate stage 1 from the job description." : "Click Edit rubric to add some."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {editable && unchecked.length > 0 && (
        <div className="unchecked">
          <span className="muted">{unchecked.length} question{unchecked.length === 1 ? " has" : "s have"} no check:</span>
          {unchecked.map((q) => (
            <button key={q.title} type="button" className="pillbtn btn-ghost btn-xs" onClick={() => onAddFor(q.title)} title={KIND_HINT(q.type)}>+ {q.title}</button>
          ))}
        </div>
      )}
    </>
  );
}

/** Stage-2 criteria (and older stage-1 criteria) as a table; a row opens the editor. */
export function CriteriaTable({ rows, total, editable, onOpen, onToggle, empty }: {
  rows: C[];
  total: number;
  editable: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, on: boolean) => void;
  empty: string;
}) {
  return (
    <div className="rtable-wrap">
      <table className="rtable">
        <colgroup><col className="w-on" /><col /><col className="w-type" /><col className="w-share" /><col className="w-go" /></colgroup>
        <thead><tr><th><span className="sr-only">On</span></th><th>Criterion</th><th>Type</th><th className="num">Share</th><th /></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} className={c.enabled ? "" : "off"} onClick={(e) => { if (!(e.target as HTMLElement).closest("input,label")) onOpen(c.id); }}>
              <td>
                <label className="switch sm" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={c.enabled} disabled={!editable} onChange={(e) => onToggle(c.id, e.target.checked)} aria-label={`Use ${c.name}`} />
                  <span />
                </label>
              </td>
              <td>
                <b className="rt-name">{c.name}{c.bias_flag && <span className="bias-mark" title={c.bias_flag}> ⚑</span>}</b>
                <span className="rt-sub clamp1">{c.description}</span>
              </td>
              <td>{c.kind === "hard" ? <span className="chip bad" title="Disqualifies when not met">Must-have</span> : <span className="chip good">Scored</span>}</td>
              <td className="num mono">{c.kind === "soft" ? `${shareOf(c, total)}%` : "—"}</td>
              <td><span className="rt-go" aria-hidden="true">›</span></td>
            </tr>
          ))}
          {!rows.length && <tr className="empty-row"><td colSpan={5}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Side panel for editing one rule or criterion. */
export function EditPanel({ item, jobId, questions, total, editable, onPatch, onRemove, onClose }: {
  item: C;
  jobId: string;
  questions: RuleQuestion[];
  total: number;
  editable: boolean;
  onPatch: (p: Partial<C>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const isRule = item.kind === "rule";
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="edit-h">
        <div className="dhead">
          <div>
            <p className="eyebrow" style={{ margin: "0 0 6px" }}>Stage {item.stage} · {isRule ? "form rule" : item.kind === "hard" ? "must-have" : "scored criterion"}</p>
            <h2 id="edit-h" style={{ margin: 0 }}>{item.name || "Untitled"}</h2>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {item.bias_flag && <div className="banner" style={{ marginBottom: 16 }}><div className="txt"><b>⚑ Possible bias risk:</b> {item.bias_flag}</div></div>}

        {isRule ? (
          editable ? (
            <RuleEditorRow jobId={jobId} row={item} questions={questions} scoreTotal={total}
              onPatch={(p) => onPatch(p as Partial<C>)} onRemove={() => { onRemove(); onClose(); }} />
          ) : (
            <div className="status-box" style={{ marginTop: 0 }}>
              <b>{item.rule!.question}</b>
              <span>{describeRule(item.rule!)}</span>
              {item.rule!.instruction && <span className="muted">{isExpectedAnswerRule(item.rule) ? "Expected answer: " : "Requirement: "}{item.rule!.instruction}</span>}
              <span>{ACTION_SHORT[item.rule!.action]} · {shareOf(item, total)}% of the stage-1 score when met</span>
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <label className="f" htmlFor="c-name">Name</label>
              <input id="c-name" type="text" value={item.name} disabled={!editable} onChange={(e) => onPatch({ name: e.target.value })} />
            </div>
            <div>
              <label className="f" htmlFor="c-desc">{item.kind === "hard" ? "How to tell it's met" : "What meets looks like"}</label>
              <textarea id="c-desc" rows={5} value={item.description} disabled={!editable} onChange={(e) => onPatch({ description: e.target.value })} />
            </div>
            <div className="row" style={{ gap: 18 }}>
              <div>
                <label className="f" htmlFor="c-kind">Type</label>
                <select id="c-kind" value={item.kind} disabled={!editable} style={{ width: "auto" }}
                  onChange={(e) => onPatch({ kind: e.target.value as "hard" | "soft", weight: e.target.value === "soft" ? item.weight || 10 : item.weight })}>
                  <option value="hard">Must-have (disqualifies when not met)</option>
                  <option value="soft">Scored (adds to the score)</option>
                </select>
              </div>
              {item.kind === "soft" && (
                <div className="wt" style={{ flex: "1 1 220px" }}>
                  <span className="hint" style={{ margin: 0, whiteSpace: "nowrap" }}>Weight</span>
                  <input type="range" min={0} max={50} step={5} value={item.weight} disabled={!editable} onChange={(e) => onPatch({ weight: Number(e.target.value) })} aria-label="Weight" />
                  <span className="mono">{shareOf(item, total)}%</span>
                </div>
              )}
            </div>
            <label className="row" style={{ gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={item.enabled} disabled={!editable} onChange={(e) => onPatch({ enabled: e.target.checked })} /> Use this criterion
            </label>
            {item.source_constraint && <p className="hint" style={{ margin: 0 }}>From your constraint: “{item.source_constraint}”</p>}
            {editable && (
              <button className="pillbtn btn-danger btn-sm" style={{ justifySelf: "start" }} onClick={() => { onRemove(); onClose(); }}>Delete criterion</button>
            )}
          </div>
        )}

        <div className="row" style={{ marginTop: 24 }}>
          <button className="pillbtn btn-dark btn-sm" onClick={onClose}>Done</button>
          {editable && <span className="hint" style={{ margin: 0 }}>Changes are kept in the draft — save or approve from the bar at the top.</span>}
        </div>
      </aside>
    </div>
  );
}
