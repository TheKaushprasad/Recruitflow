import Link from "next/link";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "@/lib/pipeline";
import { nowMs } from "@/lib/format";
import { requireUser } from "@/lib/supabase/server";
import { getJob } from "@/lib/data";
import { JobTabs } from "@/components/JobTabs";
import { JobStatusButton } from "@/components/JobStatusButton";

export default async function JobLayout({ children, params }: LayoutProps<"/jobs/[id]">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const { count } = await supabase.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", id);
  const { data: draft } = await supabase.from("rubrics").select("id").eq("job_id", id).eq("status", "draft").maybeSingle();

  // Pull new responses while the recruiter is looking, at most every 2 minutes.
  // Keeps things fresh locally (no scheduler) and between scheduled runs in production.
  const stale = !job.last_synced_at || nowMs() - new Date(job.last_synced_at).getTime() > 2 * 60_000;
  if (job.status === "open" && (job.google_form_id || job.sheet_id) && stale) {
    after(async () => {
      await runJob(createAdminClient(), job, 8);
    });
  }

  return (
    <>
      <div className="row" style={{ gap: 10, marginBottom: 4 }}>
        <Link href={job.status === "closed" ? "/jobs?view=closed" : "/jobs"} className="muted" style={{ fontSize: 13 }}>Jobs</Link>
        <span className="muted" style={{ fontSize: 13 }}>/</span>
        <b>{job.title}</b>
        {job.location && <span className="mono muted" style={{ fontSize: 13 }}>· {job.location}</span>}
        {job.status === "closed" && <span className="chip neutral">Closed</span>}
        <span className="spacer" />
        <Link className="pillbtn btn-ghost btn-sm" href={`/jobs?from=${id}`} style={{ textDecoration: "none" }}>Create similar job</Link>
        <JobStatusButton jobId={id} status={job.status} />
      </div>
      {job.status === "closed" && (
        <div className="banner" style={{ margin: "12px 0 0" }}>
          <div className="txt">
            <b>This job is closed</b>
            {job.closed_at ? ` since ${new Date(job.closed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
            {" "}New responses aren&apos;t pulled in or scored. You can still review candidates, send emails and book interviews.
          </div>
        </div>
      )}
      <JobTabs jobId={id} candidates={count ?? 0} rubricAttention={job.status === "open" && (!job.current_rubric_id || !!draft)} />
      {children}
    </>
  );
}
