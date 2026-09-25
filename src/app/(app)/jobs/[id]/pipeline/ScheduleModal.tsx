"use client";

import { useEffect, useState } from "react";
import { useAction } from "@/components/Toast";
import { getBusy, scheduleInterview } from "@/app/actions/pipeline";
import type { CandidateRow } from "@/lib/data";
import type { Job } from "@/lib/types";

function tomorrow() {
  const d = new Date(Date.now() + 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function ScheduleModal({ job, candidate, stageName, onClose }: {
  job: Job;
  candidate: CandidateRow;
  stageName: string;
  onClose: (done: boolean) => void;
}) {
  const { run, pending } = useAction();
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("11:00");
  const [dur, setDur] = useState(45);
  const [interviewers, setInterviewers] = useState("");
  const [note, setNote] = useState(`${stageName} interview for ${job.title}.`);
  const [busy, setBusy] = useState<{ start: string; end: string }[] | null>(null);
  const [busyErr, setBusyErr] = useState("");

  useEffect(() => {
    let live = true;
    const localMidnight = new Date(`${date}T00:00`);
    getBusy(localMidnight.toISOString()).then((r) => {
      if (!live) return;
      if (r.ok) { setBusy(r.busy); setBusyErr(""); } else { setBusy(null); setBusyErr(r.error); }
    });
    return () => { live = false; };
  }, [date]);

  const start = new Date(`${date}T${time}`);
  const end = new Date(start.getTime() + dur * 60_000);
  const clash = busy?.some((b) => new Date(b.start) < end && new Date(b.end) > start);

  return (
    <div className="scrim center" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Schedule interview">
        <div className="dhead">
          <div><p className="eyebrow" style={{ margin: "0 0 6px" }}>{stageName}</p><h2>Schedule {candidate.name.split(/\s+/)[0]}</h2></div>
          <button className="iconbtn" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>
        {!candidate.email && <div className="banner" style={{ background: "var(--bad-soft)" }}><div className="txt">{candidate.name} has no email on their application, so an invite can&apos;t be sent.</div></div>}
        <form onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => scheduleInterview({
            jobId: job.id, candidateId: candidate.id, startIso: start.toISOString(), durationMin: dur,
            interviewers: interviewers.split(/[,\s]+/).filter(Boolean), note,
          }));
          if (r.ok) onClose(true);
        }}>
          <div className="grid2" style={{ gap: 12 }}>
            <div className="field"><label className="f" htmlFor="sd">Date</label><input type="date" id="sd" value={date} min={tomorrow()} onChange={(e) => setDate(e.target.value)} required /></div>
            <div className="field"><label className="f" htmlFor="st">Start</label><input type="time" id="st" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
            <div className="field"><label className="f" htmlFor="sdur">Length</label>
              <select id="sdur" value={dur} onChange={(e) => setDur(Number(e.target.value))}>{[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></div>
            <div className="field"><label className="f" htmlFor="sw">Other interviewers</label><input type="text" id="sw" value={interviewers} onChange={(e) => setInterviewers(e.target.value)} placeholder="name@company.com, …" /></div>
          </div>
          <div className="field"><label className="f" htmlFor="snote">Invite description</label><textarea id="snote" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="status-box" style={{ margin: "0 0 18px" }}>
            {busyErr ? <span className="error-text">{busyErr}</span>
              : busy == null ? <span className="muted"><span className="spin" /> Checking your calendar…</span>
              : busy.length ? <span>Busy that day: {busy.map((b) => `${hhmm(b.start)}–${hhmm(b.end)}`).join(", ")}</span>
              : <span>Your calendar is free all day.</span>}
            {clash && <b style={{ color: "var(--warn)" }}>This slot overlaps something on your calendar.</b>}
            <span className="muted">The invite goes to {candidate.email ?? "—"} with a Google Meet link.</span>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="pillbtn btn-ghost btn-sm" onClick={() => onClose(false)}>Not now</button>
            <button type="submit" className="pillbtn btn-lime btn-sm" disabled={pending || !candidate.email}>{pending ? <span className="spin" /> : "Send calendar invite"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
