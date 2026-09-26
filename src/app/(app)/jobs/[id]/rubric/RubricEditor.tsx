"use client";

import { providerLabel } from "@/lib/ai/provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { approveRubric, discardDraft, editRubric, generateRubric, saveDraft } from "@/app/actions/rubric";
import { updateJobSettings } from "@/app/actions/jobs";
import { FormRulesEditor, newRule } from "@/components/FormRulesEditor";
import type { RuleQuestion } from "@/lib/rules";
import type { Criterion, Job, Rubric } from "@/lib/types";

type R = Rubric & { rubric_criteria: Criterion[] };
type C = Pick<Criterion, "id" | "kind" | "name" | "description" | "weight" | "enabled" | "source_constraint" | "bias_flag" | "rule"> & { isNew?: boolean };

export function RubricEditor({ job, current, draft, candidateCount, aiName, questions }: {
  job: Job;
  current: R | null;
  draft: R | null;
  candidateCount: number;
  aiName: string;
  questions: RuleQuestion[];
}) {
  const router = useRouter();
  const { run } = useAction();
  const shown = draft ?? current;
  const editable = !!draft;
  const [crit, setCrit] = useState<C[]>(shown?.rubric_criteria ?? []);
  const [removed, setRemoved] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [bias, setBias] = useState(draft?.bias_reviewed ?? false);
  const [threshold, setThreshold] = useState(Number(job.recheck_threshold));
  const [shortlist, setShortlist] = useState(Number(job.shortlist_threshold ?? 60));
  const [busy, setBusy] = useState<string | null>(null);

  // Re-sync local state when the server rubric changes (e.g. after regenerate/approve).
  const [seen, setSeen] = useState(shown?.id);
  if (shown?.id !== seen) {
    setSeen(shown?.id);
    setCrit(shown?.rubric_criteria ?? []);
    setRemoved([]);
    setDirty(false);
    setBias(draft?.bias_reviewed ?? false);
  }

  const hard = crit.filter((c) => c.kind === "hard");
  const soft = crit.filter((c) => c.kind === "soft");
  const rules = crit.filter((c) => c.kind === "rule");
  // Score = soft criteria + "score" form rules
  const total = useMemo(
    () => crit.filter((c) => c.enabled && (c.kind === "soft" || (c.kind === "rule" && c.rule?.action === "score"))).reduce((a, c) => a + c.weight, 0),
    [crit],
  );

  const patch = (id: string, p: Partial<C>) => {
    setCrit((all) => all.map((c) => (c.id === id ? { ...c, ...p } : c)));
    setDirty(true);
    setBias(false);
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
    const added = crit.filter((c) => c.isNew).map((c) => ({
      kind: c.kind === "rule" ? ("rule" as const) : ("soft" as const),
      name: c.name, description: c.description, weight: c.weight, rule: c.kind === "rule" ? c.rule : null,
    }));
    const r = await run(() => saveDraft(draft.id, patches, added, removed));
    if (r.ok) setDirty(false);
    return r;
  }

  if (!shown) {
    return (
      <div className="empty-state">
        <h3>No rubric yet</h3>
        <p>{aiName} reads your job description and constraints and drafts the criteria. You review it before anyone is scored.</p>
        {job.description.trim().length < 80 ? (
          <Link className="pillbtn btn-dark" href={`/jobs/${job.id}/setup`} style={{ textDecoration: "none" }}>Add the job description first</Link>
        ) : (
          <button className="pillbtn btn-lime" disabled={!!busy} onClick={() => act("gen", () => generateRubric(job.id))}>
            {busy === "gen" ? <><span className="spin" /> {aiName} is reading the JD…</> : `Generate rubric with ${aiName}`}
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Rubric v{shown.version}{editable ? " · draft" : ""}</p>
          <h2>What “a good fit” means for this job</h2>
          <p>
            {shown.source === "recruiter" ? "Edited by you." : `Drafted by ${providerLabel(shown.source)}${shown.model ? ` (${shown.model})` : ""} from your job description and constraints.`}{" "}
            {editable ? "Edit anything that's wrong — it applies to every candidate." : "Approved rubrics are locked so every score stays traceable. Start a new version to change it."}
          </p>
        </div>
        {editable ? <span className="chip warn">Not approved</span> : <span className="chip good">Approved · in use</span>}
      </div>

      {editable && current && (
        <div className="banner">
          <div className="txt"><b>Candidates are still scored on v{current.version}.</b> Approving v{draft!.version} re-scores all {candidateCount} candidates.</div>
          <button className="pillbtn btn-ghost btn-sm" disabled={!!busy} onClick={() => act("discard", () => discardDraft(job.id))}>Discard draft</button>
        </div>
      )}

      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)" }}>
        <div style={{ display: "grid", gap: 24 }}>
          <FormRulesEditor
            rows={rules}
            editable={editable}
            questions={questions}
            scoreTotal={total}
            onPatch={(id, p) => patch(id, p as Partial<C>)}
            onRemove={(id) => {
              const c = crit.find((x) => x.id === id);
              setCrit(crit.filter((x) => x.id !== id));
              if (c && !c.isNew) setRemoved([...removed, id]);
              setDirty(true); setBias(false);
            }}
            onAdd={() => {
              const rule = newRule(questions);
              setCrit([...crit, { id: `new-${crypto.randomUUID()}`, isNew: true, kind: "rule", name: `${rule.question || "New"} rule`, description: "", weight: 10, enabled: true, source_constraint: null, bias_flag: null, rule }]);
              setDirty(true); setBias(false);
            }}
          />
          <div className="panel">
            <div className="section-head" style={{ marginBottom: 6 }}><h3>AI-judged hard filters</h3><span className="muted" style={{ fontSize: 13 }}>Disqualify — never folded into the score</span></div>
            {hard.length ? hard.map((h) => (
              <div className="hard" key={h.id}>
                <label className="switch">
                  <input type="checkbox" checked={h.enabled} disabled={!editable} onChange={(e) => patch(h.id, { enabled: e.target.checked })} aria-label={`Enable ${h.name}`} />
                  <span />
                </label>
                <div className="x">
                  <b>{h.name}</b>
                  <div className="src">{h.description}</div>
                  {h.source_constraint && <div className="src">From your constraint: “{h.source_constraint}”</div>}
                </div>
              </div>
            )) : <p className="muted" style={{ fontSize: 14 }}>None. Constraints that can&apos;t be checked from a single form answer end up here, judged by {aiName}.</p>}
          </div>

          <div className="panel">
            <div className="section-head" style={{ marginBottom: 6 }}><h3>AI-scored criteria</h3><span className="mono muted" style={{ fontSize: 13 }}>weights total {total} · shown as share of 100</span></div>
            {soft.map((c) => (
              <div className="crit" key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
                <div>
                  <input className="name" type="text" id={`cn-${c.id}`} value={c.name} disabled={!editable} onChange={(e) => patch(c.id, { name: e.target.value })} aria-label="Criterion name" />
                  {editable ? (
                    <textarea rows={2} id={`cd-${c.id}`} value={c.description} onChange={(e) => patch(c.id, { description: e.target.value })} aria-label="What meets looks like" style={{ fontSize: 13, marginTop: 4 }} />
                  ) : (
                    <p className="desc">{c.description}</p>
                  )}
                  {c.bias_flag && <div className="flag">⚑ {c.bias_flag}</div>}
                </div>
                <div className="wt">
                  <input type="range" min={0} max={50} step={5} value={c.weight} disabled={!editable} onChange={(e) => patch(c.id, { weight: Number(e.target.value) })} aria-label={`Weight for ${c.name}`} />
                  <span className="mono">{total && c.enabled ? Math.round((c.weight / total) * 100) : 0}%</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {editable && (
                    <>
                      <label className="req"><input type="checkbox" checked={c.enabled} onChange={(e) => patch(c.id, { enabled: e.target.checked })} /> Use</label>
                      <button className="iconbtn" aria-label={`Remove ${c.name}`} onClick={() => { setCrit(crit.filter((x) => x.id !== c.id)); if (!c.isNew) setRemoved([...removed, c.id]); setDirty(true); setBias(false); }}>✕</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {editable && (
              <button className="pillbtn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => {
                setCrit([...crit, { id: `new-${crypto.randomUUID()}`, isNew: true, kind: "soft", name: "New criterion", description: "What meets this looks like in an application.", weight: 10, enabled: true, source_constraint: null, bias_flag: null, rule: null }]);
                setDirty(true); setBias(false);
              }}>+ Add criterion</button>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 24, alignContent: "start" }}>
          <div className="panel">
            <h3 style={{ marginBottom: 14 }}>Scoring settings</h3>
            <div className="field">
              <label className="f" htmlFor="thr">Recheck threshold <span className="mono muted">{threshold.toFixed(2)}</span></label>
              <input type="range" id="thr" min={0.5} max={0.95} step={0.05} value={threshold} style={{ width: "100%", accentColor: "var(--green)" }}
                onChange={(e) => setThreshold(Number(e.target.value))}
                onPointerUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))}
                onKeyUp={() => run(() => updateJobSettings(job.id, { recheck_threshold: threshold }))} />
              <p className="hint">Any criterion Jev scores below this confidence is sent to {aiName} for a second look. Applies to candidates scored from now on.</p>
            </div>
            <div className="field">
              <label className="f" htmlFor="shortlist">Shortlist for stage 2 at <span className="mono muted">{shortlist}+</span></label>
              <input type="range" id="shortlist" min={0} max={100} step={5} value={shortlist} style={{ width: "100%", accentColor: "var(--green)" }}
                onChange={(e) => setShortlist(Number(e.target.value))}
                onPointerUp={() => run(() => updateJobSettings(job.id, { shortlist_threshold: shortlist }))}
                onKeyUp={() => run(() => updateJobSettings(job.id, { shortlist_threshold: shortlist }))} />
              <p className="hint">Candidates with a stage-1 score at or above this (or who need review) are marked Shortlisted. You then click Evaluate to read their CV, portfolio and GitHub.</p>
            </div>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
              <label className="f" htmlFor="signoff" style={{ margin: 0 }}>Require my sign-off before scoring with a new rubric</label>
              <label className="switch"><input type="checkbox" id="signoff" defaultChecked={job.require_signoff} onChange={(e) => run(() => updateJobSettings(job.id, { require_signoff: e.target.checked }))} /><span /></label>
            </div>
          </div>

          {editable ? (
            <>
              <div className="panel">
                <h3 style={{ marginBottom: 8 }}>Bias review</h3>
                <p className="hint" style={{ margin: "0 0 14px" }}>Check that no criterion rewards or penalises age, gender, religion, caste, marital status, disability, or anything that stands in for them (graduation year, photos, “culture fit”).</p>
                <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start", fontSize: 14 }}>
                  <input type="checkbox" id="bias" checked={bias} onChange={(e) => setBias(e.target.checked)} style={{ marginTop: 3 }} />
                  I&apos;ve reviewed this rubric for proxies of protected characteristics.
                </label>
              </div>
              {dirty && <button className="pillbtn btn-ghost" disabled={!!busy} onClick={async () => { setBusy("save"); await persist(); setBusy(null); router.refresh(); }}>{busy === "save" ? <span className="spin" /> : "Save draft"}</button>}
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
                {busy === "approve" ? <span className="spin" /> : `Approve v${draft!.version}${candidateCount ? ` & score ${candidateCount} candidates` : ""}`}
              </button>
              {!bias && <p className="hint" style={{ margin: 0 }}>Tick the bias review to approve.</p>}
            </>
          ) : (
            <div className="panel" style={{ display: "grid", gap: 10 }}>
              <button className="pillbtn btn-dark" disabled={!!busy} onClick={() => act("edit", () => editRubric(job.id))}>
                {busy === "edit" ? <span className="spin" /> : `Edit as v${shown.version + 1}`}
              </button>
              <button className="pillbtn btn-ghost" disabled={!!busy} onClick={() => act("gen", () => generateRubric(job.id))}>
                {busy === "gen" ? <><span className="spin" /> Regenerating…</> : `Regenerate with ${aiName}`}
              </button>
              <p className="hint" style={{ margin: 0 }}>Both create a new draft. Current scores stay until you approve it.</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
