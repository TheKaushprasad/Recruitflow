"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAction } from "@/components/Toast";
import { CandidateDrawer } from "@/components/CandidateDrawer";
import { SendEmailModal } from "@/components/SendEmailModal";
import { ScheduleModal } from "./ScheduleModal";
import { cancelInterview, moveCandidates, saveStages } from "@/app/actions/pipeline";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import type { CandidateRow } from "@/lib/data";
import type { Criterion, EmailTemplate, Interview, Job, Stage } from "@/lib/types";

export function Board({ job, candidates, stages, interviews, criteria, templates }: {
  job: Job;
  candidates: CandidateRow[];
  stages: Stage[];
  interviews: Interview[];
  criteria: (Criterion & { version: number })[];
  templates: EmailTemplate[];
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  // optimistic stage map so drags feel instant
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const stageOf = (c: CandidateRow) => (c.id in local ? local[c.id] : c.stage_id);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftStages, setDraftStages] = useState(stages.map((s) => ({ id: s.id, name: s.name, prompt_calendar: s.prompt_calendar })));
  const [schedule, setSchedule] = useState<CandidateRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mailTo, setMailTo] = useState<string | null>(null);

  // Live updates when another tab or the scorer changes candidates.
  useEffect(() => {
    const supabase = createClient();
    const ch = supabase
      .channel(`job-${job.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidates", filter: `job_id=eq.${job.id}` }, () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [job.id, router]);

  async function move(id: string, stageId: string | null) {
    const c = candidates.find((x) => x.id === id);
    if (!c || stageOf(c) === stageId) return;
    setLocal((l) => ({ ...l, [id]: stageId }));
    const r = await run(() => moveCandidates(job.id, [id], stageId));
    if (!r.ok) { setLocal((l) => { const n = { ...l }; delete n[id]; return n; }); return; }
    const stage = stages.find((s) => s.id === stageId);
    router.refresh();
    if (stage?.prompt_calendar) setSchedule({ ...c, stage_id: stageId });
  }

  const pool = candidates.filter((c) => !stageOf(c) && c.evaluation && !c.evaluation.disqualified);
  const interviewFor = (c: CandidateRow) => interviews.find((i) => i.candidate_id === c.id && i.stage_id === stageOf(c));
  const opened = candidates.find((c) => c.id === open) ?? null;
  const [loadedAt] = useState(() => Date.now());
  const upcoming = interviews.filter((i) => new Date(i.starts_at).getTime() > loadedAt - 3600_000);

  const card = (c: CandidateRow) => {
    const iv = interviewFor(c);
    const e = c.evaluation;
    return (
      <div key={c.id} className={`kcard${dragId === c.id ? " dragging" : ""}`} draggable
        onDragStart={(ev) => { setDragId(c.id); ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", c.id); }}
        onDragEnd={() => { setDragId(null); setOver(null); }}>
        <div className="top">
          <button className="nm" onClick={() => setOpen(c.id)}>{c.name}</button>
          {e && <span className="sc">{e.score}</span>}
        </div>
        {e && <p className="rs">{e.reason}</p>}
        <div className="ft">
          {iv ? <span className="chip lime">◷ {fmtDateTime(iv.starts_at)}</span>
            : e ? <span className="chip neutral">conf {Number(e.confidence).toFixed(2)}</span> : <span />}
          <select aria-label={`Move ${c.name} to stage`} value={stageOf(c) ?? ""} onChange={(ev) => move(c.id, ev.target.value || null)}>
            <option value="">{stageOf(c) ? "Remove from pipeline" : "Move to…"}</option>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
    );
  };

  const column = (id: string | null, title: React.ReactNode, cs: CandidateRow[], empty: string, pool = false) => (
    <div key={id ?? "pool"} className={`col${pool ? " pool" : ""}${over === (id ?? "pool") ? " over" : ""}`}
      onDragOver={(ev) => { if (dragId) { ev.preventDefault(); setOver(id ?? "pool"); } }}
      onDragLeave={() => setOver(null)}
      onDrop={(ev) => { ev.preventDefault(); const cid = ev.dataTransfer.getData("text/plain") || dragId; setOver(null); setDragId(null); if (cid) move(cid, id); }}>
      <div className="colhead">{title}<span className="spacer" /><span className="mono">{cs.length}</span></div>
      <div className="cards">{cs.length ? cs.map(card) : <div className="empty">{empty}</div>}</div>
    </div>
  );

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Interview pipeline</p>
          <h2>{stages.length} stages for this job</h2>
          <p>Drag cards between columns or use the menu on each card. Score and reasoning travel with the candidate.</p>
        </div>
        <button className={`pillbtn ${editing ? "btn-dark" : "btn-ghost"} btn-sm`} disabled={pending}
          onClick={async () => {
            if (editing) {
              const r = await run(() => saveStages(job.id, draftStages));
              if (!r.ok) return;
              router.refresh();
            } else setDraftStages(stages.map((s) => ({ id: s.id, name: s.name, prompt_calendar: s.prompt_calendar })));
            setEditing(!editing);
          }}>{editing ? "Save stages" : "Edit stages"}</button>
      </div>

      {editing && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="stage-editor">
            {draftStages.map((s, i) => (
              <div className="stage-chip" key={s.id}>
                <input type="text" id={`sn-${s.id}`} value={s.name} aria-label={`Stage ${i + 1} name`}
                  onChange={(e) => setDraftStages(draftStages.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
                <button className="iconbtn" aria-label="Move left" disabled={i === 0} onClick={() => { const a = [...draftStages]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setDraftStages(a); }}>←</button>
                <button className="iconbtn" aria-label="Move right" disabled={i === draftStages.length - 1} onClick={() => { const a = [...draftStages]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setDraftStages(a); }}>→</button>
                <button className="iconbtn" aria-label={`Delete ${s.name}`} disabled={draftStages.length === 1} onClick={() => setDraftStages(draftStages.filter((x) => x.id !== s.id))}>✕</button>
              </div>
            ))}
            <button className="pillbtn btn-ghost btn-sm" onClick={() => setDraftStages([...draftStages, { id: `new-${crypto.randomUUID()}`, name: "New stage", prompt_calendar: false }])}>+ Stage</button>
          </div>
          <h3 style={{ margin: "22px 0 8px", fontSize: 15 }}>Offer to book an interview when a candidate enters…</h3>
          <div className="row">
            {draftStages.map((s) => (
              <label key={s.id} className="row" style={{ gap: 6, fontSize: 14 }}>
                <input type="checkbox" checked={s.prompt_calendar} onChange={(e) => setDraftStages(draftStages.map((x) => (x.id === s.id ? { ...x, prompt_calendar: e.target.checked } : x)))} /> {s.name}
              </label>
            ))}
          </div>
          <p className="hint">Candidates in a deleted stage move to the first stage. Nothing is sent until you confirm the invite.</p>
        </div>
      )}

      <div className="board">
        {column(null, "Ranked, not yet in pipeline", pool, "Everyone qualified is in the pipeline.", true)}
        {stages.map((s) => column(s.id, <>{s.name}{s.prompt_calendar && <span className="muted" title="Offers to book an interview" style={{ fontWeight: 400, fontSize: 12, marginLeft: 6 }}>◷</span>}</>,
          candidates.filter((c) => stageOf(c) === s.id), "Drop a candidate here"))}
      </div>

      <h3 style={{ margin: "36px 0 12px" }}>Upcoming interviews</h3>
      <div className="tablewrap">
        <table style={{ minWidth: 620 }}>
          <thead><tr><th>When</th><th>Candidate</th><th>Stage</th><th>Meet</th><th /></tr></thead>
          <tbody>
            {upcoming.length ? upcoming.map((i) => {
              const c = candidates.find((x) => x.id === i.candidate_id);
              return (
                <tr key={i.id} style={{ cursor: "default" }}>
                  <td className="mono">{fmtDateTime(i.starts_at)} · {i.duration_min}m</td>
                  <td><b>{c?.name}</b></td>
                  <td>{stages.find((s) => s.id === i.stage_id)?.name ?? "—"}</td>
                  <td>{i.meet_url ? <a href={i.meet_url} target="_blank" rel="noreferrer">Join ↗</a> : i.html_link ? <a href={i.html_link} target="_blank" rel="noreferrer">Event ↗</a> : "—"}</td>
                  <td><button className="pillbtn btn-danger btn-sm" disabled={pending} onClick={async () => { await run(() => cancelInterview(i.id)); router.refresh(); }}>Cancel</button></td>
                </tr>
              );
            }) : <tr><td colSpan={5} className="muted">No interviews booked yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {schedule && <ScheduleModal job={job} candidate={schedule} stageName={stages.find((s) => s.id === schedule.stage_id)?.name ?? "Interview"} onClose={(done) => { setSchedule(null); if (done) router.refresh(); }} />}
      {opened && (
        <CandidateDrawer job={job} candidate={{ ...opened, stage_id: stageOf(opened) ?? null }} criteria={criteria} stages={stages}
          onClose={() => setOpen(null)} onEmail={() => setMailTo(opened.id)}
          onSchedule={() => { setSchedule({ ...opened, stage_id: stageOf(opened) ?? null }); setOpen(null); }} />
      )}
      {mailTo && (
        <SendEmailModal jobId={job.id} jobTitle={job.title} templates={templates} stages={stages}
          recipients={candidates.filter((c) => c.id === mailTo)} onClose={() => setMailTo(null)} />
      )}
    </>
  );
}
