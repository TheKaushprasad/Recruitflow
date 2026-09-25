import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { NewJobForm, type JobOption } from "./NewJobForm";

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : "open";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const { supabase } = await requireUser();

  const [{ count: openCount }, { count: closedCount }] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("status", "closed"),
  ]);
  let query = supabase
    .from("jobs")
    .select("id, title, location, status, created_at, closed_at, based_on_job_id, google_form_id, sheet_id, current_rubric_id, candidates(count)")
    .eq("status", view)
    .order(view === "closed" ? "closed_at" : "created_at", { ascending: false });
  if (q) query = query.ilike("title", `%${q.replace(/[%_]/g, "")}%`);
  const { data: jobs } = await query;

  // Every job (open and closed) is a possible template for a new one.
  const { data: allJobs } = await supabase
    .from("jobs")
    .select("id, title, location, status, based_on_job_id, current_rubric_id, created_at, closed_at, description, candidates(count), form_questions(count), stages(count)")
    .order("created_at", { ascending: false });
  const count = (v: unknown) => (v as { count: number }[] | null)?.[0]?.count ?? 0;
  const options: JobOption[] = (allJobs ?? []).map((j) => ({
    id: j.id, title: j.title, location: j.location, status: j.status, based_on_job_id: j.based_on_job_id,
    current_rubric_id: j.current_rubric_id, created_at: j.created_at, closed_at: j.closed_at,
    applicants: count(j.candidates), questions: count(j.form_questions), stages: count(j.stages),
    hasDescription: Boolean(j.description?.trim()),
  }));
  const titleOf = new Map(options.map((o) => [o.id, o.title]));
  const from = typeof sp.from === "string" ? sp.from : undefined;
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

  return (
    <>
      {sp.deleted && <div className="banner ok"><div className="txt">Job deleted.</div></div>}
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Job postings</p>
          <h2>{(openCount ?? 0) + (closedCount ?? 0) ? `${openCount ?? 0} open · ${closedCount ?? 0} closed` : "Set up your first job"}</h2>
          <p>Each job gets one rubric, one application form and one pipeline. Closed jobs keep all their candidates, scores and interviews.</p>
        </div>
      </div>

      {view === "open" && <NewJobForm key={from ?? "blank"} jobs={options} initialSource={from} />}

      <div className="toolbar">
        <div className="filters">
          <Link href="/jobs" aria-pressed={view === "open"} className="filter-link">Open <span className="mono">{openCount ?? 0}</span></Link>
          <Link href="/jobs?view=closed" aria-pressed={view === "closed"} className="filter-link">Closed <span className="mono">{closedCount ?? 0}</span></Link>
        </div>
        <form action="/jobs" style={{ marginLeft: "auto" }}>
          {view === "closed" && <input type="hidden" name="view" value="closed" />}
          <input type="search" name="q" id="jobsearch" defaultValue={q} placeholder="Search job titles" aria-label="Search job titles" />
        </form>
      </div>

      {jobs?.length ? (
        <div className="jobs-grid">
          {jobs.map((j) => {
            const count = (j.candidates as unknown as { count: number }[])[0]?.count ?? 0;
            const live = j.google_form_id || j.sheet_id;
            return (
              <Link key={j.id} href={`/jobs/${j.id}`} className="job-card">
                <h3>{j.title}</h3>
                <div className="meta">
                  {j.location && <span>{j.location}</span>}
                  <span className="mono">{count} applicant{count === 1 ? "" : "s"}</span>
                </div>
                <div className="meta">
                  <span>Created {fmt(j.created_at)}</span>
                  {j.closed_at && <span>· Closed {fmt(j.closed_at)}</span>}
                </div>
                {j.based_on_job_id && titleOf.get(j.based_on_job_id) && (
                  <div className="meta"><span>Based on {titleOf.get(j.based_on_job_id)}</span></div>
                )}
                <div className="row" style={{ gap: 6 }}>
                  {j.status === "closed" ? (
                    <span className="chip neutral">Closed</span>
                  ) : (
                    <>
                      <span className={`chip ${live ? "good" : "neutral"}`}>{live ? "Form live" : "No form yet"}</span>
                      <span className={`chip ${j.current_rubric_id ? "good" : "warn"}`}>{j.current_rubric_id ? "Rubric approved" : "Rubric needed"}</span>
                    </>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <h3>{q ? "No jobs match that search" : view === "closed" ? "No closed jobs yet" : "No open jobs"}</h3>
          <p>{view === "closed" ? "Close a job from its page once hiring is done — it moves here with its full history." : "Create one above to start collecting applications."}</p>
        </div>
      )}
    </>
  );
}
