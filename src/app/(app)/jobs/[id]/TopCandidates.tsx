"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { VERDICT, deepRunning } from "@/components/DeepPanel";
import { useAction } from "@/components/Toast";
import { moveToStage2, startDeepEvaluation } from "@/app/actions/deep";
import { moveCandidates } from "@/app/actions/pipeline";
import { confLevel } from "@/lib/format";
import type { CandidateRow } from "@/lib/data";

export interface TopCandidate {
  c: CandidateRow;
  /** Stage already has an interview booked (for calendar stages). */
  needsInterview: boolean;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("") || "?";

/** The best candidates so far, each with the one next step that moves them forward. */
export function TopCandidates({ jobId, items, firstStage, threshold, canScore, total }: {
  jobId: string;
  items: TopCandidate[];
  firstStage: { id: string; name: string } | null;
  threshold: number;
  canScore: boolean;
  total: number;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const base = `/jobs/${jobId}`;
  const act = async (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => {
    const r = await run(fn);
    if (r.ok) router.refresh();
  };

  const nextAction = ({ c, needsInterview }: TopCandidate) => {
    const hasLinks = !!(c.resume_url || c.portfolio_url || c.github_url);
    if (!c.inStage2) {
      return <button className="pillbtn btn-lime btn-xs" disabled={pending || !canScore} onClick={() => act(() => moveToStage2(jobId, [c.id]))}>Move to stage 2</button>;
    }
    if (deepRunning(c.deep)) return <span className="chip neutral"><span className="spin" /> Reviewing CV</span>;
    if (c.deep?.status !== "done") {
      return hasLinks
        ? <button className="pillbtn btn-ghost btn-xs" disabled={pending} onClick={() => act(() => startDeepEvaluation(jobId, [c.id]))}>{c.deep?.status === "error" ? "Retry CV review" : "Review CV"}</button>
        : <Link className="pillbtn btn-ghost btn-xs" href={`${base}/candidates?c=${c.id}`} style={{ textDecoration: "none" }}>Add CV link</Link>;
    }
    if (!c.stage_id) {
      return firstStage
        ? <button className="pillbtn btn-ghost btn-xs" disabled={pending} onClick={() => act(() => moveCandidates(jobId, [c.id], firstStage.id))}>Add to {firstStage.name}</button>
        : <Link className="pillbtn btn-ghost btn-xs" href={`${base}/pipeline`} style={{ textDecoration: "none" }}>Set up pipeline</Link>;
    }
    return (
      <Link className={`pillbtn ${needsInterview ? "btn-dark" : "btn-ghost"} btn-xs`} href={`${base}/pipeline`} style={{ textDecoration: "none" }}>
        {needsInterview ? "Schedule interview" : "Open in pipeline"}
      </Link>
    );
  };

  return (
    <section className="ov-card">
      <div className="ov-card-head">
        <div>
          <h2>Top candidates</h2>
          <p>{total ? `Best ${items.length} of ${total} scored, by stage 1 score (stage 2 breaks ties).` : "Candidates appear here once they're scored."}</p>
        </div>
        <Link className="pillbtn btn-ghost btn-sm btn-icon" href={`${base}/candidates`} style={{ textDecoration: "none" }}>View all candidates →</Link>
      </div>
      {items.length ? (
        <ol className="top-list">
          {items.map((t) => {
            const { c } = t;
            const e = c.evaluation!;
            const [cl, ck] = confLevel(Number(e.confidence), threshold);
            const deepDone = c.deep?.status === "done" && !c.deepStale ? c.deep : null;
            return (
              <li key={c.id} className="top-row">
                <span className="top-rank mono">{c.rank}{c.tied ? "=" : ""}</span>
                <Link className="top-who" href={`${base}/candidates?c=${c.id}`}>
                  <span className="avatar mint" aria-hidden="true">{initials(c.name)}</span>
                  <span className="who-txt"><b>{c.name}</b><span>{c.email ?? "no email"}</span></span>
                </Link>
                <span className="top-score" title="Stage 1 score (form answers)">
                  <small>Stage 1</small><b className="mono">{e.score}</b>
                </span>
                <span className="top-score" title="Stage 2 CV review">
                  <small>Stage 2</small>
                  {deepDone
                    ? <span className={`chip ${deepDone.disqualified ? "bad" : VERDICT[deepDone.verdict ?? ""]?.[1] ?? "neutral"}`}>{deepDone.disqualified ? "Hard filter" : `${deepDone.score} · ${VERDICT[deepDone.verdict ?? ""]?.[0] ?? "Done"}`}</span>
                    : <span className="muted">—</span>}
                </span>
                <span className="top-conf" title="How sure the AI is about its stage-1 judgements — not a quality score">
                  {cl.toLowerCase()} confidence{e.needs_review ? " · ⚠ review" : ""}
                  <i className={`dot-${ck}`} aria-hidden="true" />
                </span>
                <span className="top-act">{nextAction(t)}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="hint" style={{ margin: "4px 0 0" }}>No qualified candidates yet.</p>
      )}
    </section>
  );
}
