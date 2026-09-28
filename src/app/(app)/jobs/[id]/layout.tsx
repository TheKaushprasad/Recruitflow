import Link from "next/link";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncJob } from "@/lib/pipeline";
import { workStage1 } from "@/lib/worker";
import { nowMs } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import { getJob } from "@/lib/data";
import { budgetFor } from "@/lib/budget";
import { JobTabs } from "@/components/JobTabs";
import { JobHeaderActions } from "@/components/JobHeaderActions";
import { Icon } from "@/components/Icon";

export default async function JobLayout({ children, params }: LayoutProps<"/jobs/[id]">) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  // Run the header queries in parallel rather than one after another.
  const job = await getJob(supabase, id);
  const [{ count }, { data: draft }, budget, { count: flagged }] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", id),
    supabase.from("rubrics").select("id").eq("job_id", id).eq("status", "draft").maybeSingle(),
    budgetFor(supabase, user.id),
    job.current_rubric_id
      ? supabase.from("evaluations").select("id", { count: "exact", head: true })
          .eq("rubric_id", job.current_rubric_id).eq("needs_review", true).eq("disqualified", false)
      : Promise.resolve({ count: 0 }),
  ]);
  const applicants = count ?? 0;
  const base = `/jobs/${id}`;
  const hasForm = Boolean(job.google_form_id || job.sheet_id);

  // The one thing that moves this job forward right now.
  const next =
    job.status === "closed" ? { label: "View candidates", href: `${base}/candidates` }
    : !job.description.trim() ? { label: "Add job description", href: `${base}/setup` }
    : !hasForm && !user.isGuest ? { label: "Set up the form", href: `${base}/setup` }
    : !job.current_rubric_id ? { label: draft ? "Approve the rubric" : "Create the rubric", href: `${base}/rubric` }
    : flagged ? { label: `Review ${flagged} flagged`, href: `${base}/candidates?f=review` }
    : applicants ? { label: "Review candidates", href: `${base}/candidates` }
    : null;

  // Pull new responses while the recruiter is looking, at most every 2 minutes.
  // Keeps things fresh locally (no scheduler) and between scheduled runs in production.
  const stale = !job.last_synced_at || nowMs() - new Date(job.last_synced_at).getTime() > 2 * 60_000;
  if (job.status === "open" && (job.google_form_id || job.sheet_id) && stale) {
    after(async () => {
      const db = createAdminClient();
      await syncJob(db, job);
      await workStage1(db, { jobId: job.id, deadline: nowMs() + 120_000 });
    });
  }

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href={job.status === "closed" ? "/jobs?view=closed" : "/jobs"} className="crumb">Jobs</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{job.title}</span>
      </nav>
      <header className="job-head">
        <span className="job-ico" aria-hidden="true"><Icon name="briefcase" size={24} /></span>
        <div className="job-head-txt">
          <h1>{job.title}</h1>
          <div className="job-meta">
            <span className={`status-dot ${job.status}`}>{job.status === "open" ? "Open" : "Closed"}</span>
            {job.location && <span><Icon name="pin" size={14} />{job.location}</span>}
            <span><Icon name="users" size={14} />{applicants} applicant{applicants === 1 ? "" : "s"}</span>
            <span>Created {new Date(job.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          </div>
        </div>
        <JobHeaderActions jobId={id} status={job.status} next={next} />
      </header>
      {job.status === "closed" && (
        <div className="banner" style={{ margin: "12px 0 0" }}>
          <div className="txt">
            <b>This job is closed</b>
            {job.closed_at ? ` since ${new Date(job.closed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
            {" "}New responses aren&apos;t pulled in or scored. You can still review candidates, send emails and book interviews.
          </div>
        </div>
      )}
      {budget.over && job.status === "open" && (
        <div className="banner" style={{ margin: "12px 0 0", background: "var(--bad-soft)" }}>
          <div className="txt"><b>Monthly AI budget reached — AI scoring is paused.</b> New responses are still collected. </div>
          <Link className="pillbtn btn-ghost btn-sm" href="/integrations" style={{ textDecoration: "none" }}>Change budget</Link>
        </div>
      )}
      <JobTabs jobId={id} candidates={applicants} rubricAttention={job.status === "open" && (!job.current_rubric_id || !!draft)} />
      {children}
    </>
  );
}
