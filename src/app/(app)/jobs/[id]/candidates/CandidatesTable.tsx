"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { CandidateDrawer } from "@/components/CandidateDrawer";
import { SendEmailModal } from "@/components/SendEmailModal";
import { SyncButton } from "@/components/SyncButton";
import { moveCandidates, exportResults } from "@/app/actions/pipeline";
import { retryScoring } from "@/app/actions/rubric";
import { confLevel } from "@/lib/format";
import type { CandidateRow } from "@/lib/data";
import type { Criterion, EmailTemplate, Job, Stage } from "@/lib/types";

const FILTERS = [
  ["all", "All"],
  ["qualified", "Qualified"],
  ["review", "Needs review"],
  ["rechecked", "Rechecked"],
  ["dq", "Disqualified"],
  ["pending", "Not scored"],
  ["error", "Failed"],
] as const;

export function CandidatesTable(props: {
  job: Job;
  candidates: CandidateRow[];
  criteria: (Criterion & { version: number })[];
  currentVersion: number | null;
  stages: Stage[];
  templates: EmailTemplate[];
  initialFilter: string;
  openId: string | null;
}) {
  const { job, candidates, stages } = props;
  const router = useRouter();
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(props.initialFilter);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(props.openId);
  const [mailTo, setMailTo] = useState<string[] | null>(null);
  const threshold = Number(job.recheck_threshold);

  const match = (c: CandidateRow, f: string) => {
    const e = c.evaluation && !c.stale ? c.evaluation : null;
    switch (f) {
      case "qualified": return !!e && !e.disqualified;
      case "review": return !!e && e.needs_review;
      case "rechecked": return !!e && e.criterion_results.some((r) => r.initial_confidence != null);
      case "dq": return !!e && e.disqualified;
      case "pending": return !e && c.score_status !== "error";
      case "error": return c.score_status === "error";
      default: return true;
    }
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter(
      (c) => match(c, filter) && (!needle || `${c.name} ${c.email ?? ""} ${c.answers.map((a) => a.answer).join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [candidates, q, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, candidates.filter((c) => match(c, k)).length])), [candidates]);

  const toggle = (id: string, on: boolean) => {
    const s = new Set(sel);
    if (on) s.add(id); else s.delete(id);
    setSel(s);
  };
  const openCandidate = (id: string | null) => {
    setOpen(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("c", id); else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  };
  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name;
  const opened = candidates.find((c) => c.id === open) ?? null;
  const staleCount = candidates.filter((c) => c.stale).length;

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Ranked shortlist{props.currentVersion ? ` · rubric v${props.currentVersion}` : ""}</p>
          <h2>{candidates.length} candidate{candidates.length === 1 ? "" : "s"}, ranked by suitability</h2>
          <p>Disqualified candidates sit below the line with the reason shown. Click anyone to see the evidence behind every criterion.</p>
        </div>
        <div className="row">
          {job.status === "open" && <SyncButton jobId={job.id} />}
          <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => exportResults(job.id))}>Export to Sheet</button>
        </div>
      </div>

      {!props.currentVersion && (
        <div className="banner"><div className="txt"><b>No approved rubric yet.</b> Candidates are pulled in but not scored until you approve one.</div></div>
      )}
      {staleCount > 0 && (
        <div className="banner"><div className="txt"><b>{staleCount} candidate{staleCount === 1 ? " is" : "s are"} still being re-scored on rubric v{props.currentVersion}.</b> Their older scores are shown faded.</div></div>
      )}

      <div className="toolbar">
        <input type="search" id="search" placeholder="Search name, email or answers" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search candidates" />
        <div className="filters">
          {FILTERS.filter(([k]) => k === "all" || counts[k] > 0 || filter === k).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} <span className="mono">{counts[k]}</span></button>
          ))}
        </div>
        <div className="bulk">
          {sel.size ? (
            <>
              <span className="mono">{sel.size} selected</span>
              {filter === "error" ? (
                <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={async () => { await run(() => retryScoring([...sel])); setSel(new Set()); router.refresh(); }}>Retry scoring</button>
              ) : (
                <button className="pillbtn btn-ghost btn-sm" disabled={pending || !stages.length} onClick={async () => {
                  const ids = [...sel].filter((id) => { const c = candidates.find((x) => x.id === id); return c && !c.stage_id && !c.evaluation?.disqualified; });
                  if (!ids.length) { run(async () => ({ ok: false, error: "Those candidates are already in the pipeline or disqualified." })); return; }
                  await run(() => moveCandidates(job.id, ids, stages[0].id).then((r) => (r.ok ? { ok: true, message: `${ids.length} added to ${stages[0].name}` } : r)));
                  setSel(new Set()); router.refresh();
                }}>Add to pipeline</button>
              )}
              <button className="pillbtn btn-dark btn-sm" onClick={() => setMailTo([...sel])}>Email {sel.size}</button>
            </>
          ) : (
            <span className="muted">Select candidates to email or add to the pipeline</span>
          )}
        </div>
      </div>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every((c) => sel.has(c.id))}
                onChange={(e) => { const s = new Set(sel); rows.forEach((c) => (e.target.checked ? s.add(c.id) : s.delete(c.id))); setSel(s); }} /></th>
              <th>#</th><th>Candidate</th><th>Score</th><th>Confidence</th><th>Why they ranked here</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const e = c.evaluation;
              const [cl, ck] = e ? confLevel(e.needs_review ? Math.min(Number(e.confidence), threshold - 0.01) : Number(e.confidence), threshold) : ["", "neutral"];
              const rechecked = e?.criterion_results.filter((r) => r.initial_confidence != null).length ?? 0;
              return (
                <tr key={c.id} className={`${e?.disqualified ? "dq" : ""} ${c.stale ? "stale" : ""}`} onClick={(ev) => { if (!(ev.target as HTMLElement).closest("input")) openCandidate(c.id); }}>
                  <td><input type="checkbox" checked={sel.has(c.id)} onChange={(ev) => toggle(c.id, ev.target.checked)} aria-label={`Select ${c.name}`} /></td>
                  <td className="rank">{c.rank ?? "—"}</td>
                  <td className="who"><b>{c.name}</b><span>{c.email ?? "no email"}</span></td>
                  <td>{e ? (
                    <div className="scorecell"><span className="n">{e.score}</span><span className={`bar ${e.disqualified ? "dim" : ""}`}><i style={{ width: `${e.score}%` }} /></span></div>
                  ) : <span className="muted">—</span>}</td>
                  <td>{e ? (
                    <>
                      <span className={`chip ${ck}`}>{cl} <span className="mono">{Number(e.confidence).toFixed(2)}</span></span>
                      {rechecked > 0 && <div className="hint" style={{ marginTop: 4 }}>↻ {rechecked} rechecked by Claude</div>}
                    </>
                  ) : null}</td>
                  <td className="reason">
                    {c.score_status === "error" ? <span className="error-text">Scoring failed: {c.score_error}</span>
                      : !e ? <span>{c.score_status === "scoring" ? "Scoring now…" : props.currentVersion ? "Waiting to be scored" : "Waiting for an approved rubric"}</span>
                      : e.disqualified ? <><b>Disqualified.</b> {e.reason}</>
                      : e.reason}
                  </td>
                  <td>
                    {e?.disqualified ? <span className="chip bad">✕ Hard filter</span>
                      : c.stage_id ? <span className="chip good">{stageName(c.stage_id)}</span>
                      : <span className="chip neutral">Not in pipeline</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 40 }}>
                {candidates.length ? "No candidates match. Clear the search or pick another filter." : "No applications yet. Share your form link — responses appear here within a few minutes."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">Score = weighted share of criteria met (borderline counts half). Jev scores each criterion; Claude rechecks anything under {threshold.toFixed(2)} confidence and writes the evidence.</p>

      {opened && (
        <CandidateDrawer
          job={job}
          candidate={opened}
          criteria={props.criteria}
          stages={stages}
          onClose={() => openCandidate(null)}
          onEmail={() => setMailTo([opened.id])}
        />
      )}
      {mailTo && (
        <SendEmailModal
          jobId={job.id}
          templates={props.templates}
          recipients={candidates.filter((c) => mailTo.includes(c.id))}
          stages={stages}
          jobTitle={job.title}
          onClose={(sent) => { setMailTo(null); if (sent) { setSel(new Set()); router.refresh(); } }}
        />
      )}
    </>
  );
}
