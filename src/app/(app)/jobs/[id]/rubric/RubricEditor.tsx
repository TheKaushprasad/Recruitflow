"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { Icon } from "@/components/Icon";
import { Menu } from "@/components/Menu";
import { approveRubric, discardDraft, editRubric, generateStage, saveDraft, type NewCriterion } from "@/app/actions/rubric";
import { updateJobSettings } from "@/app/actions/jobs";
import { defaultPoints, newRule } from "@/components/FormRulesEditor";
import { providerLabel } from "@/lib/ai/provider";
import { validateRule, type RuleQuestion } from "@/lib/rules";
import type { Criterion, Job, Rubric } from "@/lib/types";
import { CriteriaTable, EditPanel, RulesTable, type C } from "./RubricTables";

type R = Rubric & { rubric_criteria: Criterion[] };

/** Weighted items that make up a stage's score. In stage 1, every filter earns its points when passed. */
const scoresIn = (c: C, stage: 1 | 2) => c.stage === stage && c.enabled && (c.kind === "soft" || (c.kind === "rule" && c.weight > 0));
const fmt = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function RubricEditor({ job, current, draft, candidateCount, questions }: {
  job: Job;
  current: R | null;
  draft: R | null;
  candidateCount: number;
  questions: RuleQuestion[];
}) {
  const router = useRouter();
  const { run } = useAction();
  const shown = draft ?? current;
  const editable = !!draft;
  const [tab, setTab] = useState<1 | 2>(1);
  const [crit, setCrit] = useState<C[]>(shown?.rubric_criteria ?? []);
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [threshold, setThreshold] = useState(Number(job.recheck_threshold));
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // Re-sync local state when the server rubric changes (after generate / approve / edit).
  const key = `${shown?.id}:${shown?.rubric_criteria.length}:${shown?.model}`;
  const [seen, setSeen] = useState(key);
  if (key !== seen) {
    setSeen(key);
    setCrit(shown?.rubric_criteria ?? []);
    setRemoved([]);
    setDirty(false);
    setEditing(null);
  }

  const total1 = useMemo(() => crit.filter((c) => scoresIn(c, 1)).reduce((a, c) => a + c.weight, 0), [crit]);
  const total2 = useMemo(() => crit.filter((c) => scoresIn(c, 2)).reduce((a, c) => a + c.weight, 0), [crit]);
  const of = (stage: 1 | 2, kinds: C["kind"][]) => crit.filter((c) => c.stage === stage && kinds.includes(c.kind));
  const rules = of(1, ["rule"]);
  const legacy1 = of(1, ["hard", "soft"]);
  const stage2 = of(2, ["hard", "soft"]);

  const patch = (id: string, p: Partial<C>) => { setCrit((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c))); setDirty(true); };
  const remove = (id: string) => {
    const c = crit.find((x) => x.id === id);
    setCrit((all) => all.filter((x) => x.id !== id));
    if (c && !c.isNew) setRemoved((r) => [...r, id]);
    setDirty(true);
  };
  const add = (c: Omit<C, "id" | "isNew" | "enabled" | "source_constraint" | "bias_flag">) => {
    const id = `new-${crypto.randomUUID()}`;
    setCrit((all) => [...all, { ...c, id, isNew: true, enabled: true, source_constraint: null, bias_flag: null }]);
    setDirty(true);
    setEditing(id);
  };
  const addRule = (question?: string) => {
    const rule = newRule(questions, question);
    add({ stage: 1, kind: "rule", name: rule.question || "New rule", description: "", weight: defaultPoints(rule), rule });
  };
  const addCriterion = (kind: "hard" | "soft") =>
    add({ stage: 2, kind, weight: kind === "soft" ? 10 : 0, rule: null, name: kind === "soft" ? "New scored criterion" : "New must-have", description: "What to look for in the CV, portfolio or GitHub." });

  async function persist() {
    if (!draft || !dirty) return { ok: true as const };
    const orig = new Map(draft.rubric_criteria.map((c) => [c.id, c]));
    const patches = crit
      .filter((c) => !c.isNew)
      .map((c) => ({ id: c.id, patch: { name: c.name, description: c.description, weight: c.weight, enabled: c.enabled, ...(c.kind === "rule" ? { rule: c.rule } : { kind: c.kind }) } }))
      .filter(({ id, patch }) => {
        const o = orig.get(id)!;
        return (
          o.name !== patch.name || o.description !== patch.description || o.weight !== patch.weight || o.enabled !== patch.enabled ||
          ("kind" in patch && o.kind !== patch.kind) ||
          ("rule" in patch && JSON.stringify(o.rule) !== JSON.stringify(patch.rule))
        );
      });
    const added: NewCriterion[] = crit.filter((c) => c.isNew).map((c) => ({
      stage: c.stage, kind: c.kind, name: c.name, description: c.description, weight: c.weight, rule: c.kind === "rule" ? c.rule : null,
    }));
    const r = await run(() => saveDraft(draft.id, patches, added, removed));
    if (r.ok) setDirty(false);
    return r;
  }

  async function step(name: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, saveFirst = false) {
    setBusy(name);
    const saved = saveFirst ? await persist() : { ok: true };
    const r = saved.ok ? await run(fn) : saved;
    setBusy(null);
    if (r.ok) router.refresh();
    return r;
  }
  const generate = (stage: 1 | 2) => step(`gen${stage}`, () => generateStage(job.id, stage), true);

  const editingItem = crit.find((c) => c.id === editing) ?? null;
  const closeEditor = useCallback(() => setEditing(null), []);

  // Everything the approval would lock in: problems block it, bias flags need a look.
  const enabled = crit.filter((c) => c.enabled);
  const problems = enabled.filter((c) => c.kind === "rule" && c.rule).map((c) => ({ c, p: validateRule(c.rule!, questions) })).filter((x) => x.p);
  const biasFlags = enabled.filter((c) => c.bias_flag);
  const stage1Count = crit.filter((c) => c.stage === 1).length;
  const stage2Count = stage2.length;
  const impact = current
    ? `Approving re-scores ${candidateCount} candidate${candidateCount === 1 ? "" : "s"} on stage 1. Unchanged AI checks are reused, so rule and stage-2 edits cost nothing.`
    : candidateCount
      ? `Approving starts scoring all ${candidateCount} applicant${candidateCount === 1 ? "" : "s"}.`
      : "Approving starts scoring applicants as they arrive.";
  const genLabel = (stage: 1 | 2) => `${(stage === 1 ? stage1Count : stage2Count) ? "Regenerate" : "Generate"} stage ${stage} from the job description`;

  return (
    <>
      {/* Status + main actions, pinned while you scroll */}
      <div className={`rubric-bar ${editable ? "is-draft" : ""}`}>
        <div className="rb-status">
          {editable ? (
            <>
              <span className="chip warn"><span className="dot" /> Draft v{draft!.version} · not live</span>
              <span className="muted">{dirty ? "Unsaved changes" : `${draft!.source === "recruiter" ? "Edited by you" : `Drafted by ${providerLabel(draft!.source)}`} · ${fmt(draft!.created_at)}`}</span>
            </>
          ) : shown ? (
            <>
              <span className="chip good"><Icon name="check" size={13} /> v{shown.version} live</span>
              <span className="muted">Approved {fmt(shown.approved_at)}</span>
            </>
          ) : (
            <span className="chip neutral">No rubric yet</span>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {editable ? (
            <>
              {dirty && (
                <button className="pillbtn btn-ghost btn-sm" disabled={!!busy} onClick={() => step("save", async () => ({ ok: true, message: "Draft saved" }), true)}>
                  {busy === "save" ? <span className="spin" /> : "Save draft"}
                </button>
              )}
              <button className="pillbtn btn-ghost btn-sm" disabled={!!busy}
                onClick={() => { if (window.confirm(`Discard draft v${draft!.version}? Your changes in it will be lost.`)) step("discard", () => discardDraft(job.id)); }}>
                {busy === "discard" ? <span className="spin" /> : "Discard"}
              </button>
              <button className="pillbtn btn-lime btn-sm" disabled={!!busy} onClick={() => setApproving(true)}>Approve &amp; publish</button>
            </>
          ) : (
            <button className="pillbtn btn-dark btn-sm" disabled={!!busy} onClick={() => step("edit", () => editRubric(job.id))}>
              {busy === "edit" ? <span className="spin" /> : shown ? "Edit rubric" : "Start from scratch"}
            </button>
          )}
        </div>
        {editable && <p className="rb-impact">{impact}</p>}
      </div>

      <div className="stage-tabs" role="tablist" aria-label="Rubric stage">
        {([1, 2] as const).map((s) => {
          const n = s === 1 ? stage1Count : stage2Count;
          return (
            <button key={s} role="tab" aria-selected={tab === s} onClick={() => setTab(s)}>
              <span className="st-num">{s}</span>
              <span className="st-txt">
                <b>{s === 1 ? "Form screening" : "CV, portfolio & GitHub"}</b>
                <span>
                  {s === 1 ? "Every applicant · automatic" : "People you move on"} ·{" "}
                  {!n ? "not set up" : s === 1 ? `${n} rule${n === 1 ? "" : "s"}` : `${n} ${n === 1 ? "criterion" : "criteria"}`}
                </span>
              </span>
              {!n && <span className="st-warn" title="Nothing set up yet"><Icon name="alert" size={14} /></span>}
            </button>
          );
        })}
      </div>

      {tab === 1 && (
        <div className="rubric-settings">
          <div className="rs-item">
            <label className="f" htmlFor="thr" style={{ margin: 0 }}>AI recheck threshold <span className="mono">{threshold.toFixed(2)}</span></label>
            <input type="range" id="thr" min={0.5} max={0.95} step={0.05} value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onPointerUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))}
              onKeyUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))} />
            <p className="hint" style={{ margin: 0 }}>
              When Jev is less than {threshold.toFixed(2)} sure about an AI judgement, OpenAI decides it instead, and the candidate is flagged for your review.
              Higher = more OpenAI calls and more flags; lower = cheaper, fewer flags.
            </p>
          </div>
          <label className="rs-item rs-toggle" htmlFor="signoff">
            <span><b>Require my sign-off</b><span className="hint" style={{ display: "block", margin: 0 }}>A new rubric is used only after you approve it.</span></span>
            <span className="switch"><input type="checkbox" id="signoff" defaultChecked={job.require_signoff} onChange={(e) => run(() => updateJobSettings(job.id, { require_signoff: e.target.checked }))} /><span /></span>
          </label>
        </div>
      )}

      <section className="rubric-section">
        <div className="rs-head">
          <div>
            <h2>{tab === 1 ? <>Form screening rules <span className="muted">({rules.length})</span></> : <>CV review criteria <span className="muted">({stage2.length})</span></>}</h2>
            <p>
              {tab === 1
                ? `One rule per form question. Exact checks run in code; free text gets an AI check; open-ended answers are graded against an expected answer. Rules that pass earn their share of the stage-1 score. Blank or unclear answers are flagged, never rejected.`
                : `Only for candidates you move to stage 2. ${providerLabel("openai")} judges each criterion from the job description plus their CV, portfolio, GitHub and form answers, citing where the evidence came from.`}
            </p>
          </div>
          {editable ? (
            <Menu
              label={tab === 1 ? "Add rule" : "Add criterion"}
              className="pillbtn btn-dark btn-sm btn-icon"
              busy={busy === `gen${tab}`}
              trigger={<><Icon name="plus" size={15} /> {tab === 1 ? "Add rule" : "Add criterion"} <span aria-hidden="true">▾</span></>}
              items={tab === 1
                ? [
                    { label: "Add a rule", onSelect: () => addRule(), disabled: !questions.length, hint: !questions.length ? "Add form questions in Job setup first" : undefined },
                    { label: genLabel(1), onSelect: () => { if (!stage1Count || window.confirm("Replace stage 1 of this draft with a new suggestion?")) generate(1); } },
                  ]
                : [
                    { label: "Add a must-have", onSelect: () => addCriterion("hard") },
                    { label: "Add a scored criterion", onSelect: () => addCriterion("soft") },
                    { label: genLabel(2), onSelect: () => { if (!stage2Count || window.confirm("Replace stage 2 of this draft with a new suggestion?")) generate(2); } },
                  ]}
            />
          ) : shown ? null : (
            <button className="pillbtn btn-lime btn-sm" disabled={!!busy} onClick={() => generate(tab)}>
              {busy === `gen${tab}` ? <><span className="spin" /> Drafting…</> : genLabel(tab)}
            </button>
          )}
        </div>
        {busy === `gen${tab}` && <div className="status-box" style={{ margin: "0 0 12px" }}><span><span className="spin" /> OpenAI is drafting stage {tab} from the job description…</span></div>}

        {tab === 1 ? (
          <>
            <RulesTable rows={rules} questions={questions} total={total1} editable={editable} onOpen={setEditing}
              onToggle={(id, on) => patch(id, { enabled: on })} onAddFor={addRule} />
            {legacy1.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <h3 style={{ marginBottom: 4 }}>Older-style criteria</h3>
                <p className="hint" style={{ margin: "0 0 10px" }}>Still used until you delete them. Open-ended answers are now graded per question above (“AI-graded answer”).</p>
                <CriteriaTable rows={legacy1} total={total1} editable={editable} onOpen={setEditing} onToggle={(id, on) => patch(id, { enabled: on })} empty="" />
              </div>
            )}
          </>
        ) : (
          <>
            <CriteriaTable rows={stage2} total={total2} editable={editable} onOpen={setEditing} onToggle={(id, on) => patch(id, { enabled: on })}
              empty={editable ? "No criteria yet. Generate them from the job description, or add them by hand." : "No stage-2 criteria yet."} />
            {!stage2.length && <p className="hint">Until stage 2 is set up, CV reviews use the stage-1 criteria.</p>}
          </>
        )}
      </section>

      {editingItem && (
        <EditPanel item={editingItem} jobId={job.id} questions={questions} total={editingItem.stage === 1 ? total1 : total2} editable={editable}
          onPatch={(p) => patch(editingItem.id, p)} onRemove={() => remove(editingItem.id)} onClose={closeEditor} />
      )}

      {approving && draft && (
        <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && setApproving(false)}>
          <ApproveDialog
            version={draft.version}
            impact={impact}
            problems={problems.map(({ c, p }) => `${c.name}: ${p}`)}
            biasFlags={biasFlags.map((c) => ({ name: c.name, stage: c.stage, flag: c.bias_flag! }))}
            busy={busy === "approve"}
            onCancel={() => setApproving(false)}
            onApprove={async () => {
              const r = await step("approve", () => approveRubric(draft.id, true), true);
              if (r.ok) setApproving(false);
            }}
          />
        </div>
      )}
    </>
  );
}

/** Approval with the bias review built in: specific flags first, then the required confirmation. */
function ApproveDialog({ version, impact, problems, biasFlags, busy, onCancel, onApprove }: {
  version: number;
  impact: string;
  problems: string[];
  biasFlags: { name: string; stage: 1 | 2; flag: string }[];
  busy: boolean;
  onCancel: () => void;
  onApprove: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="approve-h">
      <h2 id="approve-h" style={{ marginBottom: 6 }}>Approve rubric v{version}</h2>
      <p className="hint" style={{ margin: "0 0 16px" }}>{impact}</p>

      {problems.length > 0 && (
        <div className="banner" style={{ background: "var(--bad-soft)" }}>
          <div className="txt"><b>Fix these first:</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
        </div>
      )}

      <h3 style={{ marginBottom: 8 }}>Bias review <span className="chip warn" style={{ marginLeft: 6 }}>Required</span></h3>
      {biasFlags.length ? (
        <div className="bias-list">
          <p className="hint" style={{ margin: "0 0 8px" }}>The AI marked {biasFlags.length === 1 ? "this item" : `these ${biasFlags.length} items`} as possible bias risks. Keep each only if it&apos;s truly needed for the job:</p>
          {biasFlags.map((b) => (
            <div key={b.name} className="bias-item"><div><b>⚑ {b.name}</b> <span className="muted">· stage {b.stage}</span></div><span>{b.flag}</span></div>
          ))}
        </div>
      ) : (
        <p className="hint" style={{ margin: "0 0 8px" }}>No items were marked as bias risks, but check both stages yourself.</p>
      )}
      <p className="hint" style={{ margin: "8px 0 12px" }}>
        Nothing should reward or penalise age, gender, religion, caste, marital status or disability, or anything that stands in for them:
        graduation year, photos, “culture fit”, native speaker, or a maximum on years of experience.
      </p>
      <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", fontSize: 14, gap: 10 }}>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
        I&apos;ve reviewed both stages for proxies of protected characteristics.
      </label>

      <div className="row" style={{ justifyContent: "flex-end", marginTop: 20 }}>
        <button className="pillbtn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="pillbtn btn-lime btn-sm" disabled={!checked || busy || problems.length > 0} onClick={onApprove}>
          {busy ? <span className="spin" /> : `Approve & publish v${version}`}
        </button>
      </div>
    </div>
  );
}
