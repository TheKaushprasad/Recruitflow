import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { timeAgo } from "@/lib/format";
import type { JobOption } from "../NewJobForm";
import { CreateJob } from "./CreateJob";
import { Greeting } from "./Greeting";
import { JobFilters } from "./JobFilters";
import { JobMenu } from "./JobMenu";

export interface JobStats { applied: number; scored: number; waiting: number; review: number; stage2: number; pipeline: number; failed: number }
export interface JobCardData {
  id: string;
  title: string;
  location: string | null;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  google_form_id: string | null;
  sheet_id: string | null;
  current_rubric_id: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  basedOn: string | null;
  stats: JobStats;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/** The jobs dashboard: greeting, action-focused stat tiles, filters and job cards with a hiring funnel. */
export function JobsView({
  view, jobs, totals, openCount, closedCount, totalJobs, options, locations, showMore, firstName, q, loc, from, deleted,
}: {
  view: "open" | "closed";
  jobs: JobCardData[];
  totals: { review: number; waiting: number; stage2: number; interviews: number };
  openCount: number;
  closedCount: number;
  totalJobs: number;
  options: JobOption[];
  locations: string[];
  showMore: boolean;
  firstName: string | null;
  q: string;
  loc: string;
  from?: string;
  deleted?: boolean;
}) {
  const tiles: { n: number; label: string; hint: string; icon: IconName; tone: string }[] = [
    { n: totals.review, label: "Need your review", hint: "Low-confidence or flagged scores", icon: "alert", tone: "peach" },
    { n: totals.waiting, label: "Waiting to be scored", hint: "New responses in the queue", icon: "clock", tone: "neutral" },
    { n: totals.stage2, label: "In stage 2", hint: "Moved on to CV review", icon: "file", tone: "mint" },
    { n: totals.interviews, label: "Interviews this week", hint: "Next 7 days", icon: "calendar", tone: "neutral" },
  ];

  return (
    <>
      {deleted && <div className="banner ok"><div className="txt">Job deleted.</div></div>}

      <div className="page-head">
        <div>
          <Greeting firstName={firstName} />
          <p className="page-sub">
            {openCount
              ? `${openCount} open job${openCount === 1 ? "" : "s"}${totals.review ? ` · ${totals.review} candidate${totals.review === 1 ? "" : "s"} need${totals.review === 1 ? "s" : ""} your review` : " · nothing waiting on you"}`
              : "Create a job to start collecting and screening applications."}
          </p>
        </div>
        <CreateJob jobs={options} initialSource={from} />
      </div>

      {totalJobs > 0 && (
        <div className="stat-tiles">
          {tiles.map((t) => (
            <div key={t.label} className={`stat-tile ${t.tone}`}>
              <span className="stat-ico"><Icon name={t.icon} size={18} /></span>
              <div>
                <div className="stat-n mono">{t.n}</div>
                <b>{t.label}</b>
                <span>{t.hint}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalJobs === 0 ? (
        <div className="empty-state big">
          <span className="stat-ico"><Icon name="briefcase" size={22} /></span>
          <h3>Set up your first job</h3>
          <p>Each job gets its own application form, scoring rubric and pipeline. Closed jobs keep their full history.</p>
          <CreateJob jobs={options} label="Create your first job" />
        </div>
      ) : (
        <>
          <div className="jobs-toolbar">
            <div className="filters">
              <Link href="/jobs" aria-pressed={view === "open"} className="filter-link">Open <span className="mono">{openCount}</span></Link>
              <Link href="/jobs?view=closed" aria-pressed={view === "closed"} className="filter-link">Closed <span className="mono">{closedCount}</span></Link>
            </div>
            <JobFilters key={view} locations={locations} showMore={showMore} />
          </div>

          {jobs.length ? (
            <div className="job-list">
              {jobs.map((j) => {
                const s = j.stats;
                const live = j.google_form_id || j.sheet_id;
                const pct = (n: number) => (s.applied ? `${Math.max(n ? 4 : 0, Math.round((n / s.applied) * 100))}%` : "0%");
                return (
                  <article key={j.id} className="jobcard">
                    <div className="jobcard-main">
                      <div className="jobcard-head">
                        <h3><Link href={`/jobs/${j.id}`} className="stretched">{j.title}</Link></h3>
                        <JobMenu jobId={j.id} status={j.status} />
                      </div>
                      <div className="jobcard-meta">
                        {j.location && <span><Icon name="pin" size={15} />{j.location}</span>}
                        <span><Icon name="users" size={15} />{s.applied} applicant{s.applied === 1 ? "" : "s"}</span>
                        <span>Created {fmt(j.created_at)}</span>
                        {j.closed_at && j.status === "closed" && <span>Closed {fmt(j.closed_at)}</span>}
                        {j.basedOn && <span>Based on {j.basedOn}</span>}
                      </div>
                      <div className="row" style={{ gap: 6 }}>
                        {j.status === "closed" ? (
                          <span className="chip neutral">Closed</span>
                        ) : (
                          <>
                            <span className={`chip ${live ? "good" : "neutral"}`}>{live ? <><Icon name="check" size={13} /> Form live</> : "No form yet"}</span>
                            <span className={`chip ${j.current_rubric_id ? "good" : "warn"}`}>{j.current_rubric_id ? <><Icon name="check" size={13} /> Rubric approved</> : "Rubric needed"}</span>
                          </>
                        )}
                        {s.review > 0 && <span className="chip bad">{s.review} need{s.review === 1 ? "s" : ""} review</span>}
                        {s.failed > 0 && <span className="chip bad">{s.failed} failed to score</span>}
                        {j.status === "open" && live && (
                          j.last_sync_error
                            ? <span className="chip bad" title={j.last_sync_error}>Sync failed</span>
                            : <span className="chip neutral"><Icon name="refresh" size={12} /> {j.last_synced_at ? `Synced ${timeAgo(j.last_synced_at)}` : "Not synced yet"}</span>
                        )}
                      </div>
                    </div>

                    <div className="funnel" aria-label="Hiring progress">
                      {[
                        { k: "Applied", n: s.applied, w: s.applied ? "100%" : "0%" },
                        { k: "Scored", n: s.scored, w: pct(s.scored) },
                        { k: "Stage 2", n: s.stage2, w: pct(s.stage2) },
                        { k: "Interviewing", n: s.pipeline, w: pct(s.pipeline) },
                      ].map((f) => (
                        <div key={f.k} className="funnel-step">
                          <div className="funnel-top"><span>{f.k}</span><b className="mono">{f.n}</b></div>
                          <div className="bar"><i style={{ width: f.w }} /></div>
                        </div>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <h3>{q || loc ? "No jobs match these filters" : view === "closed" ? "No closed jobs yet" : "No open jobs"}</h3>
              <p>{view === "closed" ? "Close a job from its ⋮ menu once hiring is done — it moves here with its full history." : q || loc ? "Try a different search or location." : "Create one to start collecting applications."}</p>
            </div>
          )}
        </>
      )}
    </>
  );
}
