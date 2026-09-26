"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { approveRubric, discardDraft, editRubric, generateStage, saveDraft, type NewCriterion } from "@/app/actions/rubric";
import { updateJobSettings } from "@/app/actions/jobs";
import { FormRulesEditor, newRule } from "@/components/FormRulesEditor";
import { providerLabel } from "@/lib/ai/provider";
import type { RuleQuestion } from "@/lib/rules";
import type { Criterion, Job, Rubric } from "@/lib/types";

type R = Rubric & { rubric_criteria: Criterion[] };
type C = Pick<Criterion, "id" | "kind" | "name" | "description" | "weight" | "enabled" | "source_constraint" | "bias_flag" | "rule" | "stage"> & { isNew?: boolean };

/** Weighted items that make up a stage's score. In stage 1, every filter earns its points when passed. */
const scoresIn = (c: C, stage: 1 | 2) => c.stage === stage && c.enabled && (c.kind === "soft" || (c.kind === "rule" && c.weight > 0));

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
  const [bias, setBias] = useState(draft?.bias_reviewed ?? false);
  const [threshold, setThreshold] = useState(Number(job.recheck_threshold));
  const [busy, setBusy] = useState<string | null>(null);

  // Re-sync local state when the server rubric changes (after generate / approve / edit).
  const [seen, setSeen] = useState(`${shown?.id}:${shown?.rubric_criteria.length}:${shown?.model}`);
  const key = `${shown?.id}:${shown?.rubric_criteria.length}:${shown?.model}`;
  if (key !== seen) {
    setSeen(key);
    setCrit(shown?.rubric_criteria ?? []);
    setRemoved([]);
    setDirty(false);
    setBias(draft?.bias_reviewed ?? false);
  }

  const total1 = useMemo(() => crit.filter((c) => scoresIn(c, 1)).reduce((a, c) => a + c.weight, 0), [crit]);
  const total2 = useMemo(() => crit.filter((c) => scoresIn(c, 2)).reduce((a, c) => a + c.weight, 0), [crit]);
  const of = (stage: 1 | 2, kind: C["kind"]) => crit.filter((c) => c.stage === stage && c.kind === kind);

  const changed = () => { setDirty(true); setBias(false); };
  const patch = (id: string, p: Partial<C>) => { setCrit((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c))); changed(); };
  const remove = (id: string) => {
    const c = crit.find((x) => x.id === id);
    setCrit(crit.filter((x) => x.id !== id));
    if (c && !c.isNew) setRemoved([...removed, id]);
    changed();
  };
  const add = (c: Omit<C, "id" | "isNew" | "enabled" | "source_constraint" | "bias_flag">) => {
    setCrit([...crit, { ...c, id: `new-${crypto.randomUUID()}`, isNew: true, enabled: true, source_constraint: null, bias_flag: null }]);
    changed();
  };

  async function act(name: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(name);
    const r = await run(fn);
    setBusy(null);
    if (r.ok) router.refresh();
    return r;
  }

  async function persist() {
    if (!draft || !dirty) return { ok: true as const };
    const orig = new Map(draft.rubric_criteria.map((c) => [c.id, c]));
    const patches = crit
      .filter((c) => !c.isNew)
      .map((c) => ({ id: c.id, patch: { name: c.name, description: c.description, weight: c.weight, enabled: c.enabled, ...(c.kind === "rule" ? { rule: c.rule } : {}) } }))
      .filter(({ id, patch }) => {
        const o = orig.get(id)!;
        return (
          o.name !== patch.name || o.description !== patch.description || o.weight !== patch.weight || o.enabled !== patch.enabled ||
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

  /** Generating replaces one stage in the draft, so save pending edits first. */
  async function generate(stage: 1 | 2) {
    setBusy(`gen${stage}`);
    const saved = await persist();
    if (saved.ok) {
      const r = await run(() => generateStage(job.id, stage));
      if (r.ok) router.refresh();
    }
    setBusy(null);
  }

  const genButton = (stage: 1 | 2) => {
    const has = crit.some((c) => c.stage === stage);
    return (
      <button className={`pillbtn ${has ? "btn-ghost" : "btn-lime"} btn-sm`} disabled={!!busy} onClick={() => generate(stage)}
        title={has ? `Replaces stage ${stage} of the draft with a new OpenAI suggestion` : undefined}>
        {busy === `gen${stage}` ? <><span className="spin" /> OpenAI is drafting…</> : has ? `Regenerate stage ${stage} with OpenAI` : `Generate stage ${stage} with OpenAI`}
      </button>
    );
  };

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>{shown ? `Rubric v${shown.version}${editable ? " · draft" : ""}` : "Rubric"}</p>
          <h2>How candidates are screened for this job</h2>
          <p>
            <b>Stage 1</b> screens every applicant on their form answers. You then move the people you want to <b>stage 2</b>, where OpenAI reviews their CV, portfolio and GitHub against the JD.
            {shown && (shown.source === "recruiter" ? " Last edited by you." : ` Drafted by ${providerLabel(shown.source)}${shown.model ? ` (${shown.model})` : ""}.`)}
          </p>
        </div>
        {!shown ? <span className="chip neutral">Not set up</span> : editable ? <span className="chip warn">Not approved</span> : <span className="chip good">Approved · in use</span>}
      </div>

      {editable && current && (
        <div className="banner">
          <div className="txt"><b>Candidates are still screened on v{current.version}.</b> Approving v{draft!.version} updates stage-1 results for all {candidateCount} candidates. Unchanged AI checks are reused, so filter and stage-2 edits cost nothing to apply.</div>
          <button className="pillbtn btn-ghost btn-sm" disabled={!!busy} onClick={() => act("discard", () => discardDraft(job.id))}>Discard draft</button>
        </div>
      )}

      <div className="seg" role="group" aria-label="Rubric stage">
        <button aria-pressed={tab === 1} onClick={() => setTab(1)}>Stage 1 · Form screening</button>
        <button aria-pressed={tab === 2} onClick={() => setTab(2)}>Stage 2 · CV, portfolio &amp; GitHub</button>
      </div>

      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <p className="hint" style={{ margin: 0, maxWidth: "52ch" }}>
              {tab === 1
                ? "Every applicant, automatically, as soon as they apply. Filters check single answers; scored criteria rate the open-ended answers. The result is the stage-1 score you use to decide who moves on."
                : "Only for candidates you move to stage 2. OpenAI judges each criterion from the JD plus their CV, portfolio, GitHub and form answers, and cites where each piece of evidence came from."}
            </p>
            {genButton(tab)}
          </div>

          {!editable && shown && (
            <div className="note" style={{ margin: 0 }}>This version is approved and locked. Click <b>Edit</b> to change it — you&apos;ll get a new draft version.</div>
          )}

          {tab === 1 ? (
            <>
              <FormRulesEditor
                rows={of(1, "rule")}
                editable={editable}
                questions={questions}
                scoreTotal={total1}
                onPatch={(id, p) => patch(id, p as Partial<C>)}
                onRemove={remove}
                onAdd={(question) => {
                  const rule = newRule(questions, question);
                  add({ stage: 1, kind: "rule", name: rule.question || "New filter", description: "", weight: 10, rule });
                }}
              />
              {of(1, "hard").length > 0 && (
                <CriteriaList title="Other AI-judged filters" hint="Disqualify when not met — judged from the form answers" stage={1} kind="hard"
                  rows={of(1, "hard")} editable={editable} total={total1} onPatch={patch} onRemove={remove} onAdd={add} />
              )}
              <CriteriaList title="Scored criteria for free-text answers" hint="Rate the open-ended answers; make up the stage-1 score" stage={1} kind="soft"
                rows={of(1, "soft")} editable={editable} total={total1} onPatch={patch} onRemove={remove} onAdd={add} />
            </>
          ) : (
            <>
              <CriteriaList title="Must-haves" hint="Disqualify when not met — judged from the CV and work samples" stage={2} kind="hard"
                rows={of(2, "hard")} editable={editable} total={total2} onPatch={patch} onRemove={remove} onAdd={add} />
              <CriteriaList title="Scored criteria" hint="Make up the stage-2 suitability score" stage={2} kind="soft"
                rows={of(2, "soft")} editable={editable} total={total2} onPatch={patch} onRemove={remove} onAdd={add} />
              {!crit.some((c) => c.stage === 2) && (
                <div className="note" style={{ margin: 0 }}>No stage-2 rubric yet. Until you create one, stage-2 reviews use the stage-1 criteria.</div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
          <div className="panel">
            <h3 style={{ marginBottom: 14 }}>Settings</h3>
            <div className="field">
              <label className="f" htmlFor="thr">AI recheck threshold (stage 1) <span className="mono muted">{threshold.toFixed(2)}</span></label>
              <input type="range" id="thr" min={0.5} max={0.95} step={0.05} value={threshold} style={{ width: "100%", accentColor: "var(--green)" }}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onPointerUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))}
                onKeyUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))} />
              <p className="hint">Anything Jev judges below this confidence is rechecked by OpenAI.</p>
            </div>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <label className="f" htmlFor="signoff" style={{ margin: 0 }}>Require my sign-off before a new rubric is used</label>
              <label className="switch"><input type="checkbox" id="signoff" defaultChecked={job.require_signoff} onChange={(e) => run(() => updateJobSettings(job.id, { require_signoff: e.target.checked }))} /><span /></label>
            </div>
          </div>

          {editable ? (
            <>
              <div className="panel">
                <h3 style={{ marginBottom: 8 }}>Bias review</h3>
                <p className="hint" style={{ margin: "0 0 14px" }}>Check both stages: nothing should reward or penalise age, gender, religion, caste, marital status, disability, or anything that stands in for them (graduation year, photos, “culture fit”, a maximum on experience).</p>
                <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", fontSize: 14 }}>
                  <input type="checkbox" id="bias" checked={bias} onChange={(e) => setBias(e.target.checked)} style={{ marginTop: 3 }} />
                  I&apos;ve reviewed both stages for proxies of protected characteristics.
                </label>
              </div>
              {dirty && (
                <button className="pillbtn btn-ghost" disabled={!!busy} onClick={async () => { setBusy("save"); await persist(); setBusy(null); router.refresh(); }}>
                  {busy === "save" ? <span className="spin" /> : "Save draft"}
                </button>
              )}
              <button className="pillbtn btn-lime" disabled={!!busy || !bias}
                onClick={async () => {
                  setBusy("approve");
                  const saved = await persist();
                  if (saved.ok) {
                    const r = await run(() => approveRubric(draft!.id, bias));
                    if (r.ok) router.refresh();
                  }
                  setBusy(null);
                }}>
                {busy === "approve" ? <span className="spin" /> : `Approve v${draft!.version}`}
              </button>
              {!bias && <p className="hint" style={{ margin: 0 }}>Tick the bias review to approve.</p>}
            </>
          ) : (
            <div className="panel" style={{ display: "grid", gap: 10 }}>
              <button className="pillbtn btn-dark" disabled={!!busy} onClick={() => act("edit", () => editRubric(job.id))}>
                {busy === "edit" ? <span className="spin" /> : shown ? `Edit as v${shown.version + 1}` : "Start from scratch"}
              </button>
              <p className="hint" style={{ margin: 0 }}>
                {shown ? "Creates a draft. Current results stay until you approve it." : "Or use “Generate … with OpenAI” to get a first draft of each stage."}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CriteriaList({ title, hint, stage, kind, rows, editable, total, onPatch, onRemove, onAdd }: {
  title: string;
  hint: string;
  stage: 1 | 2;
  kind: "hard" | "soft";
  rows: C[];
  editable: boolean;
  total: number;
  onPatch: (id: string, p: Partial<C>) => void;
  onRemove: (id: string) => void;
  onAdd: (c: Omit<C, "id" | "isNew" | "enabled" | "source_constraint" | "bias_flag">) => void;
}) {
  return (
    <div className="panel">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h3>{title}</h3>
        <span className="muted" style={{ fontSize: 13 }}>{kind === "soft" ? `weights total ${total} · shown as share of 100` : hint}</span>
      </div>
      {kind === "soft" && <p className="hint" style={{ margin: "0 0 6px" }}>{hint}</p>}
      {rows.length === 0 && <p className="muted" style={{ fontSize: 14 }}>None yet.</p>}
      {rows.map((c) => (
        <div className="crit" key={c.id} style={{ opacity: c.enabled ? 1 : 0.5, gridTemplateColumns: kind === "soft" ? undefined : "1fr auto" }}>
          <div>
            <input className="name" type="text" id={`cn-${c.id}`} value={c.name} disabled={!editable} onChange={(e) => onPatch(c.id, { name: e.target.value })} aria-label={kind === "soft" ? "Criterion name" : "Must-have name"} />
            {editable ? (
              <textarea rows={2} id={`cd-${c.id}`} value={c.description} onChange={(e) => onPatch(c.id, { description: e.target.value })}
                aria-label={kind === "soft" ? "What meets looks like" : "How to tell it's met"} style={{ fontSize: 13, marginTop: 4 }} />
            ) : (
              <p className="desc">{c.description}</p>
            )}
            {c.source_constraint && <div className="src" style={{ fontSize: 12.5, color: "var(--muted)" }}>From your constraint: “{c.source_constraint}”</div>}
            {c.bias_flag && <div className="flag">⚑ {c.bias_flag}</div>}
          </div>
          {kind === "soft" && (
            <div className="wt">
              <input type="range" min={0} max={50} step={5} value={c.weight} disabled={!editable} onChange={(e) => onPatch(c.id, { weight: Number(e.target.value) })} aria-label={`Weight for ${c.name}`} />
              <span className="mono">{total && c.enabled ? Math.round((c.weight / total) * 100) : 0}%</span>
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            {editable ? (
              <>
                <label className="req"><input type="checkbox" checked={c.enabled} onChange={(e) => onPatch(c.id, { enabled: e.target.checked })} /> Use</label>
                <button className="iconbtn" aria-label={`Delete ${c.name}`} onClick={() => onRemove(c.id)}>✕</button>
              </>
            ) : !c.enabled ? <span className="muted" style={{ fontSize: 13 }}>Not used</span> : null}
          </div>
        </div>
      ))}
      {editable && (
        <button className="pillbtn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() =>
          onAdd({
            stage, kind, weight: kind === "soft" ? 10 : 0, rule: null,
            name: kind === "soft" ? "New criterion" : "New must-have",
            description: stage === 1 ? "What a strong answer looks like in the form." : "What to look for in the CV, portfolio or GitHub.",
          })}>
          + Add {kind === "soft" ? "criterion" : "must-have"}
        </button>
      )}
    </div>
  );
}
