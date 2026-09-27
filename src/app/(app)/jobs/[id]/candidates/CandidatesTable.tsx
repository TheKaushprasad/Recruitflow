"use client";

import { providerLabel } from "@/lib/ai/provider";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { CandidateDrawer } from "@/components/CandidateDrawer";
import { VERDICT, deepRunning } from "@/components/DeepPanel";
import { moveToStage2, startDeepEvaluation } from "@/app/actions/deep";
import { SendEmailModal } from "@/components/SendEmailModal";
import { SyncButton } from "@/components/SyncButton";
import { moveCandidates, exportResults } from "@/app/actions/pipeline";
import { retryScoring } from "@/app/actions/rubric";
import { confLevel } from "@/lib/format";
import type { CandidateRow } from "@/lib/data";
import type { Criterion, EmailTemplate, Job, Stage } from "@/lib/types";

const FILTERS = [
  ["all", "All"],
  ["stage1", "Stage 1"],
  ["stage2", "Stage 2"],
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
  aiName: string;
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
  const critById = useMemo(() => new Map(props.criteria.map((c) => [c.id, c])), [props.criteria]);

  /** Stage-1 breakdown: filters passed, the free-text answers' own score, and what needs review. */
  const breakdown = (e: NonNullable<CandidateRow["evaluation"]>) => {
    const rs = e.criterion_results.map((r) => ({ r, c: critById.get(r.criterion_id) })).filter((x) => x.c);
    // Filters = single-answer checks; Answers = open-ended answers graded against an expected answer (or older criteria).
    const graded = (x: (typeof rs)[number]) => x.c!.kind === "soft" || (x.c!.kind === "rule" && x.c!.rule?.op === "ai_expected");
    const filters = rs.filter((x) => x.c!.kind === "rule" && !graded(x));
    const open = rs.filter(graded);
    const w = open.reduce((a, x) => a + (x.c!.weight || 1), 0);
    const val: Record<string, number> = { meets: 1, borderline: 0.5, not_met: 0 };
    const answers = w ? Math.round((open.reduce((a, x) => a + (x.c!.weight || 1) * (val[x.r.decision] ?? 0), 0) / w) * 100) : null;
    const review = rs
      .filter(({ r, c }) =>
        r.decision === "unclear" ||
        (c!.kind === "rule" && c!.rule?.action === "flag" && (r.decision === "fail" || r.decision === "not_met")) ||
        (r.scored_by !== "rule" && Number(r.confidence) < threshold))
      .map(({ c }) => c!.name);
    return {
      filters: { passed: filters.filter((x) => x.r.decision === "pass").length, total: filters.length },
      answers,
      review,
      aiJudged: rs.some((x) => x.r.scored_by !== "rule"),
    };
  };

  const match = (c: CandidateRow, f: string) => {
    const e = c.evaluation && !c.stale ? c.evaluation : null;
    switch (f) {
      case "stage1": return !c.inStage2;
      case "stage2": return c.inStage2;
      case "qualified": return !!e && !e.disqualified;
      case "review": return !!e && e.needs_review;
      case "rechecked": return !!e && e.criterion_results.some((r) => r.initial_confidence != null);
      case "dq": return !!e && e.disqualified;
      case "pending": return !e && c.score_status !== "error";
      case "error": return c.score_status === "error";
      default: return true;
    }
  };
  const [sortBy, setSortBy] = useState<"stage1" | "deep">("stage1");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = candidates.filter(
      (c) => match(c, filter) && (!needle || `${c.name} ${c.email ?? ""} ${c.answers.map((a) => a.answer).join(" ")}`.toLowerCase().includes(needle)),
    );
    if (sortBy === "deep") {
      const deepScore = (c: CandidateRow) =>
        c.deep?.status === "done" && !c.deepStale ? (c.deep.disqualified ? -1 : c.deep.score ?? -1) : -2;
      return [...list].sort((a, b) => deepScore(b) - deepScore(a)); // stable: ties keep stage-1 order
    }
    return list;
  }, [candidates, q, filter, sortBy]);

  // Refresh while stage-2 evaluations are running.
  const anyRunning = candidates.some((c) => deepRunning(c.deep));
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [anyRunning, router]);

  /** Move to stage 2 (which starts the CV review), or re-run the review for people already there. */
  const toStage2 = async (ids: string[]) => {
    const r = await run(() => moveToStage2(job.id, ids));
    if (r.ok) { setSel(new Set()); router.refresh(); }
  };
  const reEvaluate = async (ids: string[]) => {
    const r = await run(() => startDeepEvaluation(job.id, ids));
    if (r.ok) router.refresh();
  };
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
        <select id="sortBy" aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as "stage1" | "deep")} style={{ width: "auto", padding: "7px 10px", fontSize: 13, borderRadius: 99 }}>
          <option value="stage1">Sort: stage 1 score</option>
          <option value="deep">Sort: stage 2 score</option>
        </select>
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
              <button className="pillbtn btn-lime btn-sm" disabled={pending || !props.currentVersion || sel.size > 10}
                title={sel.size > 10 ? "Move up to 10 at a time — each one is reviewed right away" : "Moves them to stage 2 and starts the CV, portfolio and GitHub review"}
                onClick={() => toStage2([...sel])}>Move {sel.size} to stage 2</button>
              <button className="pillbtn btn-dark btn-sm" onClick={() => setMailTo([...sel])}>Email {sel.size}</button>
            </>
          ) : (
            <span className="muted">Select candidates to evaluate, email or add to the pipeline</span>
          )}
        </div>
      </div>

      <div className="tablewrap">
        <table className="cand-table">
          <thead>
            <tr>
              <th><input type="checkbox" aria-label="Select all shown" checked={rows.length > 0 && rows.every((c) => sel.has(c.id))}
                onChange={(e) => { const s = new Set(sel); rows.forEach((c) => (e.target.checked ? s.add(c.id) : s.delete(c.id))); setSel(s); }} /></th>
              <th>#</th><th>Candidate</th><th>Stage 1 score</th><th>Confidence</th><th>Why they ranked here</th>
              <th className="stage2-start">Stage 2 · CV review</th><th>Why they ranked here</th><th>Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const e = c.evaluation;
              const b = e ? breakdown(e) : null;
              const [cl, ck] = e && b?.aiJudged ? confLevel(Number(e.confidence), threshold) : ["", "neutral"];
              const rechecked = e?.criterion_results.filter((r) => r.initial_confidence != null).length ?? 0;
              return (
                <tr key={c.id} className={`${e?.disqualified ? "dq" : ""} ${c.stale ? "stale" : ""}`} onClick={(ev) => { if (!(ev.target as HTMLElement).closest("input")) openCandidate(c.id); }}>
                  <td><input type="checkbox" checked={sel.has(c.id)} onChange={(ev) => toggle(c.id, ev.target.checked)} aria-label={`Select ${c.name}`} /></td>
                  <td className="rank">{c.rank ?? "—"}</td>
                  <td className="who"><b>{c.name}</b><span>{c.email ?? "no email"}</span></td>
                  <td>{!e ? <span className="muted">—</span> : e.disqualified ? (
                    <span className="chip bad" title={e.reason}>✕ Rejected by filter</span>
                  ) : (
                    <div style={{ display: "grid", gap: 4 }}>
                      <div className="scorecell"><span className="n">{e.score}</span><span className="bar"><i style={{ width: `${e.score}%` }} /></span></div>
                      <span className="hint mono" style={{ margin: 0, fontSize: 12 }}>
                        {b!.filters.total > 0 && <>Filters {b!.filters.passed}/{b!.filters.total} ✓</>}
                        {b!.filters.total > 0 && b!.answers != null && " · "}
                        {b!.answers != null && <>Answers {b!.answers}/100</>}
                      </span>
                    </div>
                  )}</td>
                  <td>{!e ? null : (
                    <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
                      {b!.aiJudged
                        ? <span className={`chip ${ck}`} title="Average confidence of the AI's judgements">{cl} <span className="mono">{Number(e.confidence).toFixed(2)}</span></span>
                        : <span className="muted" title="No AI judgement — decided by exact filters only">—</span>}
                      {e.needs_review && !e.disqualified && (
                        <span className="chip warn" title={b!.review.join("; ")}>Needs review{b!.review.length ? `: ${b!.review[0]}${b!.review.length > 1 ? ` +${b!.review.length - 1}` : ""}` : ""}</span>
                      )}
                      {rechecked > 0 && <span className="hint" style={{ margin: 0 }}>↻ {rechecked} rechecked by {providerLabel(e.criterion_results.find((r) => r.initial_confidence != null)?.scored_by)}</span>}
                    </div>
                  )}</td>
                  <td className="reason">
                    {c.score_status === "error" ? <span className="error-text">Scoring failed: {c.score_error}</span>
                      : !e ? <span>{c.score_status === "scoring" ? "Scoring now…" : props.currentVersion ? "Waiting to be scored" : "Waiting for an approved rubric"}</span>
                      : e.disqualified ? <><b>Disqualified.</b> {e.reason}</>
                      : e.reason}
                  </td>
                  <td className="stage2-start" onClick={(ev) => ev.stopPropagation()}>
                    {!c.inStage2 ? (
                      e?.disqualified ? <span className="muted">—</span> : (
                        <button className="pillbtn btn-lime btn-sm" disabled={pending || !props.currentVersion || !e}
                          title={!e ? "Waiting for the stage-1 result" : "Move to stage 2 and review their CV, portfolio and GitHub"}
                          onClick={() => toStage2([c.id])}>
                          Move to stage 2
                        </button>
                      )
                    ) : c.deep && deepRunning(c.deep) ? (
                      <span className="chip neutral"><span className="spin" /> Reviewing CV</span>
                    ) : c.deep?.status === "done" ? (
                      <div style={{ display: "grid", gap: 4, opacity: c.deepStale ? 0.6 : 1 }}>
                        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                          <b className="mono">{c.deep.score}</b>
                          <span className={`chip ${c.deep.disqualified ? "bad" : VERDICT[c.deep.verdict ?? ""]?.[1] ?? "neutral"}`}>
                            {c.deep.disqualified ? "Hard filter" : VERDICT[c.deep.verdict ?? ""]?.[0] ?? "Done"}
                          </span>
                        </span>
                        {c.deepStale && <span className="hint" style={{ margin: 0 }}>older rubric</span>}
                      </div>
                    ) : !(c.resume_url || c.portfolio_url || c.github_url) ? (
                      <button className="btn-link" style={{ fontSize: 13 }} onClick={() => openCandidate(c.id)}>In stage 2 · add a CV link</button>
                    ) : (
                      <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
                        <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={() => reEvaluate([c.id])}>
                          {c.deep?.status === "error" ? "Retry review" : "Review CV"}
                        </button>
                        {c.deep?.status === "error" && <span className="error-text" style={{ fontSize: 12 }}>Last run failed</span>}
                      </div>
                    )}
                  </td>
                  <td className="reason" style={{ opacity: c.deepStale ? 0.6 : 1 }}>
                    {!c.inStage2 ? <span className="muted">—</span>
                      : c.deep && deepRunning(c.deep) ? <span>Reading their CV, portfolio and GitHub…</span>
                      : c.deep?.status === "error" ? <span className="error-text">Review failed: {c.deep.error}</span>
                      : c.deep?.status === "done" ? (
                        <>
                          {c.deep.disqualified && <b>Fails a must-have. </b>}
                          {c.deep.summary}
                          {c.deepStale && <span className="hint" style={{ margin: "4px 0 0", display: "block" }}>Reviewed on an older rubric — review again for the current one.</span>}
                        </>
                      )
                      : !(c.resume_url || c.portfolio_url || c.github_url) ? <span>No CV, portfolio or GitHub link yet.</span>
                      : <span>Not reviewed yet.</span>}
                  </td>
                  <td>
                    {e?.disqualified ? <span className="chip bad">✕ Filter</span>
                      : c.stage_id ? <span className="chip good">{stageName(c.stage_id)}</span>
                      : <span className="chip neutral">Not in pipeline</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={9} className="muted" style={{ textAlign: "center", padding: 40 }}>
                {candidates.length ? "No candidates match. Clear the search or pick another filter." : "No applications yet. Share your form link — responses appear here within a few minutes."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Stage 1 screens everyone on their form answers: filters check single answers (exactly, or with an AI check for free text), and the score is the weighted share of criteria met (borderline counts half). Jev judges first and {props.aiName} rechecks anything under {threshold.toFixed(2)} confidence.
        You decide who moves on: <b>Move to stage 2</b> starts {props.aiName}&apos;s review of their CV, portfolio and GitHub against the JD and the stage-2 rubric.
      </p>

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
