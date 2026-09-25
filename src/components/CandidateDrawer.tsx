"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "./Toast";
import { moveCandidates } from "@/app/actions/pipeline";
import { retryScoring } from "@/app/actions/rubric";
import { DECISION_LABEL, confLevel } from "@/lib/format";
import type { CandidateRow } from "@/lib/data";
import type { Criterion, Job, Stage } from "@/lib/types";

export function CandidateDrawer({ job, candidate: c, criteria, stages, onClose, onEmail, onSchedule }: {
  job: Job;
  candidate: CandidateRow;
  criteria: (Criterion & { version: number })[];
  stages: Stage[];
  onClose: () => void;
  onEmail: () => void;
  onSchedule?: () => void;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const closeRef = useRef<HTMLButtonElement>(null);
  const threshold = Number(job.recheck_threshold);
  const e = c.evaluation;
  const byId = new Map(criteria.map((x) => [x.id, x]));
  const results = (e?.criterion_results ?? [])
    .map((r) => ({ r, crit: byId.get(r.criterion_id) }))
    .filter((x) => x.crit)
    .sort((a, b) => a.crit!.position - b.crit!.position);
  const hard = results.filter((x) => x.crit!.kind === "hard");
  const soft = results.filter((x) => x.crit!.kind === "soft");
  const totalW = soft.reduce((a, x) => a + x.crit!.weight, 0);
  const version = results[0]?.crit?.version;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="scrim" onClick={(ev) => ev.target === ev.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={c.name}>
        <div className="dhead">
          <div>
            <p className="eyebrow" style={{ margin: "0 0 6px" }}>
              {c.submitted_at ? `Applied ${new Date(c.submitted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Applicant"}
              {version ? ` · rubric v${version}` : ""}{c.stale ? " (outdated)" : ""}
            </p>
            <h2>{c.name}</h2>
            <div className="muted" style={{ fontSize: 14 }}>
              {c.email ?? "No email"}
              {c.resume_url && <> · <a href={c.resume_url.startsWith("http") ? c.resume_url : `https://${c.resume_url}`} target="_blank" rel="noreferrer noopener">Resume link ↗</a></>}
            </div>
          </div>
          <button className="iconbtn" ref={closeRef} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {e?.disqualified && (
          <div className="banner" style={{ background: "var(--bad-soft)" }}>
            <div className="txt"><b style={{ color: "var(--bad)" }}>Disqualified by a hard filter.</b> {e.reason}</div>
          </div>
        )}
        {c.score_status === "error" && (
          <div className="banner" style={{ background: "var(--bad-soft)" }}>
            <div className="txt"><b style={{ color: "var(--bad)" }}>Scoring failed.</b> {c.score_error}</div>
            <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={async () => { await run(() => retryScoring([c.id])); router.refresh(); }}>Retry</button>
          </div>
        )}

        {e && (
          <>
            <div className="kv">
              <div><small>Score</small><b className="mono">{e.score}</b></div>
              <div><small>Confidence</small><b className="mono">{Number(e.confidence).toFixed(2)}</b></div>
              <div><small>Stage</small><b style={{ fontSize: 16 }}>{stages.find((s) => s.id === c.stage_id)?.name ?? "—"}</b></div>
            </div>
            {!e.disqualified && <p style={{ margin: "0 0 22px", fontSize: 15 }}>{e.reason}</p>}
          </>
        )}

        <div className="row" style={{ marginBottom: 28 }}>
          {!e?.disqualified && (
            <select aria-label="Pipeline stage" value={c.stage_id ?? ""} style={{ width: "auto" }} disabled={pending}
              onChange={async (ev) => { await run(() => moveCandidates(job.id, [c.id], ev.target.value || null)); router.refresh(); }}>
              <option value="">Not in pipeline</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {onSchedule && c.stage_id && <button className="pillbtn btn-ghost btn-sm" onClick={onSchedule}>Schedule interview</button>}
          <button className="pillbtn btn-ghost btn-sm" onClick={onEmail}>Email</button>
        </div>

        {hard.length > 0 && <h3 style={{ marginBottom: 10 }}>Hard filters</h3>}
        {hard.map(({ r, crit }) => <Evidence key={r.id} name={crit!.name} r={r} threshold={threshold} />)}
        {soft.length > 0 && <h3 style={{ margin: "22px 0 10px" }}>Criterion by criterion</h3>}
        {soft.map(({ r, crit }) => (
          <Evidence key={r.id} name={crit!.name} weight={totalW ? Math.round((crit!.weight / totalW) * 100) : 0} r={r} threshold={threshold} />
        ))}

        <h3 style={{ margin: "22px 0 10px" }}>Application answers</h3>
        {c.answers.map((a, i) => (
          <div className="answer" key={i}><small>{a.question}</small>{a.answer || <span className="muted">(blank)</span>}</div>
        ))}
        <p className="hint">The resume is linked for context only. PDF contents aren&apos;t parsed or scored in this version.</p>
      </aside>
    </div>
  );
}

function Evidence({ name, weight, r, threshold }: {
  name: string;
  weight?: number;
  r: { decision: string; confidence: number; evidence: string; scored_by: string; initial_confidence: number | null };
  threshold: number;
}) {
  const [dl, dk] = DECISION_LABEL[r.decision] ?? [r.decision, "neutral"];
  const conf = Number(r.confidence);
  const [, ck] = confLevel(conf, threshold);
  return (
    <div className="ev">
      <div className="h">
        <b>{name}{weight != null && <span className="mono muted" style={{ fontWeight: 400 }}> · {weight}%</span>}</b>
        <span className={`chip ${dk}`}>{dl}</span>
      </div>
      <q>{r.evidence || "No evidence recorded."}</q>
      <div className="h">
        <span className="meta">
          {r.initial_confidence != null ? `Jev ${Number(r.initial_confidence).toFixed(2)} → rechecked by Claude` : r.scored_by === "jev" ? "Scored by Jev · evidence by Claude" : "Scored by Claude"}
        </span>
        <span className="confbar"><i style={{ ["--w" as string]: `${Math.round(conf * 100)}%`, ["--c" as string]: `var(--${ck})` }} />{conf.toFixed(2)}</span>
      </div>
    </div>
  );
}
