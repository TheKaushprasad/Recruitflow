import Link from "next/link";
import { activeProvider, PROVIDER_LABEL } from "@/lib/ai/provider";
import { requireUser } from "@/lib/supabase/server";
import { getCandidates, getInterviews, getJob, getRelatedJobs, getRubrics, getStages } from "@/lib/data";
import { RelatedJobs } from "@/components/RelatedJobs";
import { SyncStatus } from "@/components/SyncStatus";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Icon, type IconName } from "@/components/Icon";
import { nowMs } from "@/lib/format";
import { TopCandidates } from "./TopCandidates";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

const TOP_N = 5;

export default async function JobOverview({ params }: PageProps<"/jobs/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const [cands, rubrics, interviews, stages, related] = await Promise.all([
    getCandidates(supabase, job),
    getRubrics(supabase, job),
    getInterviews(supabase, id),
    getStages(supabase, id),
    getRelatedJobs(supabase, job),
  ]);
  const base = `/jobs/${id}`;
  const now = nowMs(); // request time (server component)
  const ai = PROVIDER_LABEL[activeProvider() ?? "openai"];
  const hasForm = Boolean(job.google_form_id || job.sheet_id);
  const calStages = new Set(stages.filter((s) => s.prompt_calendar).map((s) => s.id));

  const scored = cands.filter((c) => c.evaluation && !c.stale);
  const qualified = scored.filter((c) => !c.evaluation!.disqualified);
  const review = scored.filter((c) => c.evaluation!.needs_review && !c.evaluation!.disqualified);
  const inStage2 = cands.filter((c) => c.inStage2);
  const reviewed2 = inStage2.filter((c) => c.deep?.status === "done").length;
  const interviewing = cands.filter((c) => c.stage_id && !c.evaluation?.disqualified).length;
  const newToday = cands.filter((c) => now - new Date(c.submitted_at ?? c.created_at).getTime() < 864e5).length;
  const upcoming = interviews
    .filter((i) => { const t = new Date(i.starts_at).getTime(); return t > now && t < now + 7 * 864e5; })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const errors = cands.filter((c) => c.score_status === "error").length;
  const waiting = cands.filter((c) => !c.evaluation || c.stale).length - errors;
  const noInterview = (c: (typeof cands)[number]) =>
    !!c.stage_id && calStages.has(c.stage_id) && !interviews.some((i) => i.candidate_id === c.id && i.stage_id === c.stage_id);

  // Best first: stage-1 rank, with the stage-2 score breaking ties.
  const deepScore = (c: (typeof cands)[number]) => (c.deep?.status === "done" && !c.deepStale && !c.deep.disqualified ? c.deep.score ?? -1 : -1);
  const top = [...qualified]
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || deepScore(b) - deepScore(a))
    .slice(0, TOP_N)
    .map((c) => ({ c, needsInterview: noInterview(c) }));

  const tiles: { n: number; label: string; hint: string; icon: IconName; tone: string; href: string }[] = [
    { n: cands.length, label: "Applicants", hint: newToday ? `+${newToday} in the last 24 hours` : "None new in the last 24 hours", icon: "users", tone: "", href: `${base}/candidates` },
    { n: review.length, label: "Need your review", hint: "Low-confidence or flagged scores", icon: "alert", tone: review.length ? "peach" : "", href: `${base}/candidates?f=review` },
    { n: inStage2.length, label: "In stage 2", hint: inStage2.length ? `${reviewed2} CV review${reviewed2 === 1 ? "" : "s"} done` : "Move your best candidates on", icon: "file", tone: "mint", href: `${base}/candidates?f=stage2` },
    {
      n: upcoming.length, label: "Interviews this week", icon: "calendar", tone: "", href: `${base}/pipeline`,
      hint: upcoming.length ? `Next: ${new Date(upcoming[0].starts_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}` : "Next 7 days",
    },
  ];

  const funnel = [
    { label: "Applied", n: cands.length, href: `${base}/candidates` },
    { label: "Scored", n: scored.length, href: `${base}/candidates?f=qualified` },
    { label: "Stage 2", n: inStage2.length, href: `${base}/candidates?f=stage2` },
    { label: "Interviewing", n: interviewing, href: `${base}/pipeline` },
  ];
  const pct = (n: number) => (cands.length ? Math.round((n / cands.length) * 100) : 0);

  const attn: { sev?: "bad"; title: string; detail: string; href: string; cta: string }[] = [];
  if (job.last_sync_error) attn.push({ sev: "bad", title: "Couldn't read new responses", detail: job.last_sync_error, href: "/integrations", cta: "Check" });
  if (errors) attn.push({ sev: "bad", title: `${errors} failed to score`, detail: "Retry them from the Candidates tab.", href: `${base}/candidates?f=error`, cta: "View" });
  if (rubrics.current && rubrics.draft) attn.push({ title: `Rubric v${rubrics.draft.version} isn't approved`, detail: `Scores still use v${rubrics.current.version}.`, href: `${base}/rubric`, cta: "Review" });
  for (const c of scored.filter((c) => c.evaluation!.disqualified && c.evaluation!.score >= 80))
    attn.push({ sev: "bad", title: `${c.name} scores high but fails a hard filter`, detail: c.evaluation!.reason, href: `${base}/candidates?c=${c.id}`, cta: "View" });
  if (review.length) attn.push({ title: `${review.length} candidate${review.length === 1 ? " needs" : "s need"} review`, detail: `Low confidence (under ${Number(job.recheck_threshold).toFixed(2)}) or a flagged answer. Read the evidence before deciding.`, href: `${base}/candidates?f=review`, cta: "Review" });
  const unbooked = cands.filter(noInterview);
  if (unbooked.length) attn.push({ title: `${unbooked.length} without an interview booked`, detail: unbooked.slice(0, 3).map((c) => c.name).join(", ") + (unbooked.length > 3 ? "…" : ""), href: `${base}/pipeline`, cta: "Schedule" });

  const setup: { done: boolean; label: string; detail: string; href: string }[] = [
    { done: !!job.description.trim(), label: "Job description", detail: job.description.trim() ? "Added" : `${ai} builds the rubric from it`, href: `${base}/setup` },
    { done: hasForm, label: "Application form", detail: hasForm ? (job.form_source === "linked" ? "Linked Google Form" : "Google Form live") : "Build or link one", href: `${base}/setup` },
    {
      done: !!rubrics.current, label: "Rubric", href: `${base}/rubric`,
      detail: rubrics.current
        ? `v${rubrics.current.version} approved · ${rubrics.current.rubric_criteria.filter((c) => c.stage === 1 && c.enabled).length} stage-1 · ${rubrics.current.rubric_criteria.filter((c) => c.stage === 2 && c.enabled).length} stage-2 checks`
        : rubrics.draft ? "Draft waiting for approval" : "Not created yet",
    },
    { done: stages.length > 0, label: "Interview pipeline", detail: stages.length ? stages.map((s) => s.name).join(" → ") : "Add stages", href: `${base}/pipeline` },
  ];
  const setupDone = setup.every((s) => s.done);

  return (
    <>
      <LiveRefresh jobId={id} busy={cands.some((c) => c.score_status === "scoring")} />
      <div className="stat-tiles">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className={`stat-tile ${t.tone}`} style={{ textDecoration: "none", color: "inherit" }}>
            <span className="stat-ico"><Icon name={t.icon} size={18} /></span>
            <div>
              <div className="stat-n mono">{t.n}</div>
              <b>{t.label}</b>
              <span suppressHydrationWarning>{t.hint}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className="ov-grid">
        <div className="ov-main">
          <TopCandidates
            jobId={id}
            items={top}
            total={qualified.length}
            firstStage={stages[0] ? { id: stages[0].id, name: stages[0].name } : null}
            threshold={Number(job.recheck_threshold)}
            canScore={!!rubrics.current}
          />

          <section className="ov-card">
            <div className="ov-card-head">
              <div>
                <h2>Hiring progress</h2>
                <p>
                  {waiting > 0 ? `${waiting} waiting to be scored · ` : ""}
                  {scored.length - qualified.length} rejected by filters
                </p>
              </div>
              <Link className="pillbtn btn-ghost btn-sm" href={`${base}/pipeline`} style={{ textDecoration: "none" }}>Open pipeline →</Link>
            </div>
            <ol className="funnel-bar">
              {funnel.map((f, i) => (
                <li key={f.label} className={f.n ? "on" : ""}>
                  <Link href={f.href}>
                    <span className="fb-label">{f.label}</span>
                    <b className="mono">{f.n}</b>
                    <span className="fb-pct">{i === 0 ? "all applicants" : `${pct(f.n)}%`}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="ov-side">
          <section className="ov-card">
            <div className="ov-card-head"><h2>Needs you</h2>{attn.length > 0 && <span className="chip warn">{attn.length}</span>}</div>
            {attn.length ? (
              <ul className="needs">
                {attn.map((a, i) => (
                  <li key={i}>
                    <span className={`sev-dot ${a.sev ?? ""}`} aria-hidden="true" />
                    <div className="txt"><b>{a.title}</b><span>{a.detail}</span></div>
                    <Link className="btn-link" href={a.href} style={{ fontSize: 13 }}>{a.cta}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint" style={{ margin: 0 }}>Nothing right now. New responses are scored automatically.</p>
            )}
          </section>

          <section className="ov-card">
            <div className="ov-card-head">
              <h2>Setup</h2>
              {setupDone ? <span className="chip good"><Icon name="check" size={13} /> Complete</span> : <span className="chip warn">{setup.filter((s) => !s.done).length} to do</span>}
            </div>
            <ul className="setup-list">
              {setup.map((s) => (
                <li key={s.label} className={s.done ? "done" : ""}>
                  <span className="tick" aria-hidden="true">{s.done ? <Icon name="check" size={13} /> : null}</span>
                  <Link href={s.href}><b>{s.label}</b><span>{s.detail}</span></Link>
                </li>
              ))}
            </ul>
            <div className="setup-foot">
              {hasForm && job.status === "open" && <SyncStatus jobId={id} lastSyncedAt={job.last_synced_at} error={job.last_sync_error} />}
              <Link className="btn-link" href={`/emails?job=${id}`} style={{ fontSize: 13 }}>Email history</Link>
            </div>
          </section>
        </aside>
      </div>

      <hr className="rule" />
      <RelatedJobs jobId={id} related={related} />
    </>
  );
}
