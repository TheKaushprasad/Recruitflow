"use client";

import { providerLabel } from "@/lib/ai/provider";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useAction } from "@/components/Toast";
import { CandidateDrawer } from "@/components/CandidateDrawer";
import { VERDICT, deepRunning } from "@/components/DeepPanel";
import { Icon } from "@/components/Icon";
import { Menu, type MenuItem } from "@/components/Menu";
import { SendEmailModal } from "@/components/SendEmailModal";
import { SyncStatus } from "@/components/SyncStatus";
import { TestApplication, type ApplyQuestion } from "@/components/TestApplication";
import { useLiveRefresh } from "@/components/useLiveRefresh";
import { moveToStage2, startDeepEvaluation } from "@/app/actions/deep";
import { moveCandidates, exportResults } from "@/app/actions/pipeline";
import { retryScoring } from "@/app/actions/rubric";
import { confLevel, timeAgo } from "@/lib/format";
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

type SortKey = "default" | "name" | "stage1" | "confidence" | "stage2";
const PAGE_SIZE = 25;
/** Stage 2 can take this many at once (reviews run from a queue). */
const STAGE2_MAX = 100;

const appliedAt = (c: CandidateRow) => c.submitted_at ?? c.created_at;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("") || "?";
const AVATAR_TONES = ["mint", "peach", "lime", "sky", "lilac"];
const tone = (id: string) => AVATAR_TONES[[...id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % AVATAR_TONES.length];

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
  /** Guest demo: questions for "Submit a test application". */
  demo?: { questions: ApplyQuestion[]; autoOpen: boolean } | null;
}) {
  const { job, candidates, stages } = props;
  const router = useRouter();
  const { run, pending } = useAction();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(props.initialFilter);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(props.openId);
  const [mailTo, setMailTo] = useState<string[] | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "default", dir: "desc" });
  const [page, setPage] = useState(0);
  const threshold = Number(job.recheck_threshold);
  const critById = useMemo(() => new Map(props.criteria.map((c) => [c.id, c])), [props.criteria]);

  /** Stage-1 breakdown: filters passed, the free-text answers' own score, and what needs review. */
  const breakdown = (e: NonNullable<CandidateRow["evaluation"]>) => {
    const rs = e.criterion_results.map((r) => ({ r, c: critById.get(r.criterion_id) })).filter((x) => x.c);
    // Filters = single-answer checks; Answers = open-ended answers graded against an expected answer (or older criteria).
    const graded = (x: (typeof rs)[number]) => x.c!.kind === "soft" || (x.c!.kind === "rule" && x.c!.rule?.op === "ai_expected");
    const filters = rs.filter((x) => x.c!.kind === "rule" && !graded(x));
    const openEnded = rs.filter(graded);
    const w = openEnded.reduce((a, x) => a + (x.c!.weight || 1), 0);
    const val: Record<string, number> = { meets: 1, borderline: 0.5, not_met: 0 };
    const answers = w ? Math.round((openEnded.reduce((a, x) => a + (x.c!.weight || 1) * (val[x.r.decision] ?? 0), 0) / w) * 100) : null;
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

  const stage1Score = (c: CandidateRow) => (!c.evaluation ? -2 : c.evaluation.disqualified ? -1 : c.evaluation.score);
  const stage2Score = (c: CandidateRow) =>
    c.deep?.status === "done" && !c.deepStale ? (c.deep.disqualified ? -1 : c.deep.score ?? -1) : -2;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = candidates.filter(
      (c) => match(c, filter) && (!needle || `${c.name} ${c.email ?? ""} ${c.answers.map((a) => a.answer).join(" ")}`.toLowerCase().includes(needle)),
    );
    const d = sort.dir === "asc" ? 1 : -1;
    const byNewest = (a: CandidateRow, b: CandidateRow) => appliedAt(b).localeCompare(appliedAt(a));
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case "name": return d * a.name.localeCompare(b.name);
        case "stage1": return d * (stage1Score(a) - stage1Score(b)) || byNewest(a, b);
        case "confidence": return d * (Number(a.evaluation?.confidence ?? -1) - Number(b.evaluation?.confidence ?? -1)) || byNewest(a, b);
        case "stage2": return d * (stage2Score(a) - stage2Score(b)) || stage1Score(b) - stage1Score(a);
        default:
          // Everyone moved to stage 2 first (best CV review on top), then the newest applications.
          if (a.inStage2 !== b.inStage2) return a.inStage2 ? -1 : 1;
          if (a.inStage2) return stage2Score(b) - stage2Score(a) || stage1Score(b) - stage1Score(a);
          return byNewest(a, b);
      }
    });
  }, [candidates, q, filter, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  // Live updates: new responses, stage-1 scores and CV reviews appear without a reload.
  const anyScoring = candidates.some((c) => c.score_status === "scoring");
  const anyRunning = candidates.some((c) => deepRunning(c.deep));
  const anyWaiting = !!props.currentVersion && job.status === "open" && candidates.some((c) => !c.evaluation && c.score_status === "pending");
  useLiveRefresh(job.id, anyScoring || anyRunning, anyWaiting);

  const done = () => { setSel(new Set()); router.refresh(); };
  const toStage2 = async (ids: string[]) => { const r = await run(() => moveToStage2(job.id, ids)); if (r.ok) done(); };
  const reEvaluate = async (ids: string[]) => { const r = await run(() => startDeepEvaluation(job.id, ids)); if (r.ok) router.refresh(); };
  const toPipeline = async (ids: string[]) => {
    const ok = ids.filter((id) => { const c = candidates.find((x) => x.id === id); return c && !c.stage_id && !c.evaluation?.disqualified; });
    if (!ok.length) { await run(async () => ({ ok: false, error: "Those candidates are already in the pipeline or disqualified." })); return; }
    const r = await run(() => moveCandidates(job.id, ok, stages[0].id).then((x) => (x.ok ? { ok: true, message: `${ok.length} added to ${stages[0].name}` } : x)));
    if (r.ok) done();
  };
  const retry = async (ids: string[]) => { const r = await run(() => retryScoring(ids)); if (r.ok) done(); };

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, candidates.filter((c) => match(c, k)).length])),
    [candidates]);

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
  const sortBy = (key: SortKey) => {
    setPage(0);
    setSort((s) => (s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: key === "name" ? "asc" : "desc" }));
  };
  const stageName = (id: string | null) => stages.find((s) => s.id === id)?.name;
  const opened = candidates.find((c) => c.id === open) ?? null;
  const staleCount = candidates.filter((c) => c.stale).length;
  const selected = candidates.filter((c) => sel.has(c.id));
  const selErrored = selected.filter((c) => c.score_status === "error").map((c) => c.id);
  const selMovable = selected.filter((c) => !c.inStage2 && c.evaluation && !c.evaluation.disqualified).map((c) => c.id);

  const exportCsv = () => {
    const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Rank", "Name", "Email", "Applied", "Stage 1 score", "Confidence", "Needs review", "Why (stage 1)", "Stage 2 score", "Stage 2 verdict", "Why (stage 2)", "Pipeline stage"];
    const lines = rows.map((c) => {
      const e = c.evaluation;
      return [
        c.rank ?? "", c.name, c.email ?? "", appliedAt(c).slice(0, 10),
        e ? (e.disqualified ? "Rejected by filter" : e.score) : "", e ? Number(e.confidence).toFixed(2) : "", e?.needs_review ? "yes" : "",
        e?.reason ?? "", c.deep?.status === "done" ? c.deep.score : "", c.deep?.status === "done" ? VERDICT[c.deep.verdict ?? ""]?.[0] ?? "" : "",
        c.deep?.status === "done" ? c.deep.summary : "", stageName(c.stage_id) ?? "",
      ].map(cell).join(",");
    });
    const blob = new Blob(["﻿" + [head.map(cell).join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${job.title.replace(/[^\w-]+/g, "-")}-candidates.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const th = (k: SortKey, children: React.ReactNode, className?: string) => (
    <th key={k} className={className} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button className="th-sort" onClick={() => sortBy(k)}>
        {children}<span className="sort-ind" aria-hidden="true">{sort.key === k ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );

  return (
    <>
      <div className="cand-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h2 style={{ margin: 0 }}>Candidates <span className="muted" style={{ fontWeight: 500 }}>({candidates.length})</span></h2>
            {props.currentVersion && <span className="chip neutral" title="Scores use this rubric version">Rubric v{props.currentVersion}</span>}
          </div>
          <p className="page-sub" style={{ marginTop: 6 }}>Stage 2 candidates first, then the newest applications. Click anyone to see the full evaluation.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {props.demo && job.status === "open" && <TestApplication jobId={job.id} questions={props.demo.questions} autoOpen={props.demo.autoOpen} />}
          {job.status === "open" && (job.google_form_id || job.sheet_id) && (
            <SyncStatus jobId={job.id} lastSyncedAt={job.last_synced_at} error={job.last_sync_error} />
          )}
          <Menu
            label="Export"
            className="pillbtn btn-ghost btn-sm btn-icon"
            busy={pending}
            trigger={<>Export <span aria-hidden="true">▾</span></>}
            items={[
              { label: "To a Google Sheet tab", onSelect: () => run(() => exportResults(job.id)) },
              { label: `Download CSV (${rows.length} shown)`, onSelect: exportCsv },
            ]}
          />
        </div>
      </div>

      {!props.currentVersion && (
        <div className="banner"><div className="txt"><b>No approved rubric yet.</b> Candidates are pulled in but not scored until you approve one.</div></div>
      )}
      {staleCount > 0 && (
        <div className="banner"><div className="txt"><b>{staleCount} candidate{staleCount === 1 ? " is" : "s are"} still being re-scored on rubric v{props.currentVersion}.</b> Their older scores are shown faded.</div></div>
      )}

      <div className="cand-toolbar">
        <label className="searchbox">
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search name, email or answers" aria-label="Search candidates" />
        </label>
        <div className="filters">
          {FILTERS.filter(([k]) => k === "all" || counts[k] > 0 || filter === k).map(([k, l]) => (
            <button key={k} aria-pressed={filter === k} onClick={() => { setFilter(k); setPage(0); }}>{l} <span className="mono">{counts[k]}</span></button>
          ))}
        </div>
        {sort.key !== "default" && (
          <button className="btn-link" style={{ fontSize: 13, marginLeft: "auto" }} onClick={() => { setSort({ key: "default", dir: "desc" }); setPage(0); }}>
            Reset order
          </button>
        )}
      </div>

      <div className="cand-card">
        <table className="ctable">
          <colgroup>
            <col className="w-sel" /><col className="w-rank" /><col className="w-who" /><col className="w-s1" /><col className="w-conf" />
            <col className="w-why" /><col className="w-s2" /><col className="w-why" /><col className="w-act" />
          </colgroup>
          <thead>
            <tr>
              <th className="c-sel"><input type="checkbox" aria-label="Select all on this page" checked={shown.length > 0 && shown.every((c) => sel.has(c.id))}
                onChange={(e) => { const s = new Set(sel); shown.forEach((c) => (e.target.checked ? s.add(c.id) : s.delete(c.id))); setSel(s); }} /></th>
              <th className="c-rank" title="Rank by stage 1 score (= means tied)">#</th>
              {th("name", "Candidate")}
              {th("stage1", "Stage 1")}
              {th("confidence", "Confidence")}
              <th>Why (stage 1)</th>
              {th("stage2", "Stage 2", "stage2-start")}
              <th>Why (stage 2)</th>
              <th className="c-act"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const e = c.evaluation;
              const b = e ? breakdown(e) : null;
              const [cl, ck] = e && b?.aiJudged ? confLevel(Number(e.confidence), threshold) : ["", "neutral"];
              const rechecked = e?.criterion_results.filter((r) => r.initial_confidence != null).length ?? 0;
              const hasLinks = !!(c.resume_url || c.portfolio_url || c.github_url);
              const actions: MenuItem[] = [
                { label: "View details", onSelect: () => openCandidate(c.id) },
                ...(!c.inStage2 && e && !e.disqualified ? [{ label: "Move to stage 2", onSelect: () => toStage2([c.id]), disabled: pending || !props.currentVersion }] : []),
                ...(c.inStage2 && hasLinks && !deepRunning(c.deep) ? [{ label: c.deep?.status === "done" ? "Review CV again" : "Review CV", onSelect: () => reEvaluate([c.id]) }] : []),
                ...(!c.stage_id && !e?.disqualified && stages.length ? [{ label: `Add to ${stages[0].name}`, onSelect: () => toPipeline([c.id]) }] : []),
                ...(c.email ? [{ label: "Email", onSelect: () => setMailTo([c.id]) }] : []),
                ...(c.score_status === "error" ? [{ label: "Retry scoring", onSelect: () => retry([c.id]) }] : []),
              ];
              return (
                <tr key={c.id} className={`${e?.disqualified ? "dq" : ""} ${c.stale ? "stale" : ""} ${sel.has(c.id) ? "is-sel" : ""}`}
                  onClick={(ev) => { if (!(ev.target as HTMLElement).closest("input,button,a")) openCandidate(c.id); }}>
                  <td className="c-sel"><input type="checkbox" checked={sel.has(c.id)} onChange={(ev) => toggle(c.id, ev.target.checked)} aria-label={`Select ${c.name}`} /></td>
                  <td className="c-rank mono">{c.rank ? `${c.rank}${c.tied ? "=" : ""}` : "—"}</td>
                  <td className="c-who"><div className="who-cell">
                    <span className={`avatar ${tone(c.id)}`} aria-hidden="true">{initials(c.name)}</span>
                    <div className="who-txt">
                      <b title={c.name}>{c.name}</b>
                      <span title={c.email ?? undefined}>{c.email ?? "no email"}</span>
                      <span className="applied" suppressHydrationWarning>
                        Applied {timeAgo(appliedAt(c))}
                        {c.stage_id && !e?.disqualified && <> · <span className="chip good mini">{stageName(c.stage_id)}</span></>}
                      </span>
                    </div>
                  </div></td>
                  <td className="c-s1" data-label="Stage 1">
                    {!e ? <span className="muted">—</span> : e.disqualified ? (
                      <span className="chip bad" title={e.reason}>✕ Rejected by filter</span>
                    ) : (
                      <div className="s1">
                        <span className="s1-n"><b className="mono">{e.score}</b><span className="muted"> / 100</span></span>
                        <span className="bar"><i style={{ width: `${e.score}%` }} /></span>
                        <span className="s1-break mono">
                          {b!.filters.total > 0 && <>Filters {b!.filters.passed}/{b!.filters.total}</>}
                          {b!.filters.total > 0 && b!.answers != null && " · "}
                          {b!.answers != null && <>Answers {b!.answers}</>}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="c-conf" data-label="Confidence">
                    {!e ? null : (
                      <div className="conf">
                        {b!.aiJudged
                          ? <span className={`chip ${ck}`} title="Average confidence of the AI's judgements">{cl} <span className="mono">{Number(e.confidence).toFixed(2)}</span></span>
                          : <span className="muted" title="No AI judgement — decided by exact filters only">—</span>}
                        <span className="conf-icons">
                          {e.needs_review && !e.disqualified && (
                            <span className="flag warn" title={`Needs review: ${b!.review.join("; ") || "low confidence"}`} aria-label="Needs review">
                              <Icon name="alert" size={14} />{b!.review.length > 0 && <span className="mono">{b!.review.length}</span>}
                            </span>
                          )}
                          {rechecked > 0 && (
                            <span className="flag" title={`${rechecked} item${rechecked === 1 ? "" : "s"} rechecked by ${providerLabel(e.criterion_results.find((r) => r.initial_confidence != null)?.scored_by)}`} aria-label="Rechecked">
                              <Icon name="refresh" size={13} /><span className="mono">{rechecked}</span>
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="c-why" data-label="Why (stage 1)">
                    <p className="clamp">
                      {c.score_status === "error" ? <span className="error-text">Scoring failed: {c.score_error}</span>
                        : !e ? <span className="muted" title={c.score_error ?? undefined}>{c.score_status === "scoring" ? "Scoring now…" : c.score_error ? "Hit a temporary error — retrying automatically" : props.currentVersion ? "Waiting to be scored" : "Waiting for an approved rubric"}</span>
                        : e.disqualified ? <><b className="bad-text">Disqualified.</b> {e.reason}</>
                        : e.reason}
                    </p>
                  </td>
                  <td className="c-s2 stage2-start" data-label="Stage 2">
                    {!c.inStage2 ? (
                      e && !e.disqualified ? (
                        <button className="pillbtn btn-lime btn-xs" disabled={pending || !props.currentVersion}
                          title="Move to stage 2 and review their CV, portfolio and GitHub" onClick={() => toStage2([c.id])}>
                          Move to stage 2
                        </button>
                      ) : <span className="muted">—</span>
                    ) : c.deep && deepRunning(c.deep) ? (
                      <span className="chip neutral"><span className="spin" /> {c.deep.status === "running" ? "Reviewing" : "Queued"}</span>
                    ) : c.deep?.status === "done" ? (
                      <div className="s2" style={{ opacity: c.deepStale ? 0.6 : 1 }}>
                        <span><b className="mono">{c.deep.score}</b><span className="muted"> / 100</span></span>
                        <span className={`chip ${c.deep.disqualified ? "bad" : VERDICT[c.deep.verdict ?? ""]?.[1] ?? "neutral"}`}>
                          {c.deep.disqualified ? "Hard filter" : VERDICT[c.deep.verdict ?? ""]?.[0] ?? "Done"}
                        </span>
                      </div>
                    ) : !hasLinks ? (
                      <button className="btn-link" style={{ fontSize: 13 }} onClick={() => openCandidate(c.id)}>Add a CV link</button>
                    ) : (
                      <button className="pillbtn btn-ghost btn-xs" disabled={pending} onClick={() => reEvaluate([c.id])}>
                        {c.deep?.status === "error" ? "Retry review" : "Review CV"}
                      </button>
                    )}
                  </td>
                  <td className="c-why" data-label="Why (stage 2)" style={{ opacity: c.deepStale ? 0.6 : 1 }}>
                    <p className="clamp">
                      {!c.inStage2 ? <span className="muted">—</span>
                        : c.deep && deepRunning(c.deep) ? <span className="muted">Reading their CV, portfolio and GitHub…</span>
                        : c.deep?.status === "error" ? <span className="error-text">Review failed: {c.deep.error}</span>
                        : c.deep?.status === "done" ? <>{c.deep.disqualified && <b className="bad-text">Fails a must-have. </b>}{c.deep.summary}</>
                        : !hasLinks ? <span className="muted">No CV, portfolio or GitHub link yet.</span>
                        : <span className="muted">Not reviewed yet.</span>}
                    </p>
                  </td>
                  <td className="c-act">
                    <Menu label={`Actions for ${c.name}`} trigger={<Icon name="more" />} items={actions} />
                  </td>
                </tr>
              );
            })}
            {!shown.length && (
              <tr className="empty-row"><td colSpan={9}>
                {candidates.length ? "No candidates match. Clear the search or pick another filter." : "No applications yet. Share your form link — responses appear here within a couple of minutes."}
              </td></tr>
            )}
          </tbody>
        </table>

        {rows.length > PAGE_SIZE && (
          <div className="pager">
            <span className="muted">Showing {current * PAGE_SIZE + 1}–{Math.min(rows.length, (current + 1) * PAGE_SIZE)} of {rows.length}</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="iconbtn" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>‹</button>
              <span className="mono">{current + 1} / {pages}</span>
              <button className="iconbtn" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>›</button>
            </div>
          </div>
        )}
        {rows.length > 0 && rows.length <= PAGE_SIZE && (
          <div className="pager"><span className="muted">Showing {rows.length} of {rows.length}</span></div>
        )}
      </div>

      {sel.size > 0 && (
        <div className="bulkbar" role="region" aria-label="Selected candidates">
          <span className="mono"><b>{sel.size}</b> selected</span>
          <button className="pillbtn btn-lime btn-sm" disabled={pending || !props.currentVersion || !selMovable.length || selMovable.length > STAGE2_MAX}
            title={!selMovable.length ? "Pick scored, qualified candidates still in stage 1" : "Moves them to stage 2 and queues the CV, portfolio and GitHub review"}
            onClick={() => toStage2(selMovable)}>
            Move {selMovable.length || ""} to stage 2
          </button>
          <button className="pillbtn btn-ghost btn-sm" disabled={pending || !stages.length} onClick={() => toPipeline([...sel])}>Add to pipeline</button>
          <button className="pillbtn btn-ghost btn-sm" onClick={() => setMailTo([...sel])}>Email</button>
          {selErrored.length > 0 && <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={() => retry(selErrored)}>Retry scoring</button>}
          <button className="iconbtn" aria-label="Clear selection" onClick={() => setSel(new Set())}><Icon name="x" size={16} /></button>
        </div>
      )}

      <details className="infobox">
        <summary><Icon name="alert" size={15} /> How scores work</summary>
        <p>
          <b>Stage 1</b> screens everyone on their form answers. Exact filters (notice period, pay, options) are checked in code. Free-text
          answers are judged by Jev first; anything Jev is less than {threshold.toFixed(2)} confident about goes to {props.aiName}, and
          “Explain” in a candidate&apos;s panel writes the evidence for Jev&apos;s confident calls. The score is the weighted share of criteria
          met (borderline counts half), and tied scores share a rank (“1=”).
        </p>
        <p>
          <b>Stage 2</b> is your call: <b>Move to stage 2</b> queues {props.aiName}&apos;s review of their CV, portfolio and GitHub against
          the job description and the stage-2 rubric.
        </p>
      </details>

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
          onClose={(sent) => { setMailTo(null); if (sent) done(); }}
        />
      )}
    </>
  );
}
