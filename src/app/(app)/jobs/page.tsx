import { requireUser } from "@/lib/supabase/server";
import { nowMs } from "@/lib/format";
import type { JobOption } from "./NewJobForm";
import { JobsView, type JobStats } from "./_ui/JobsView";
import { SORTS, type SortKey } from "./_ui/sorts";

interface CandStat {
  job_id: string;
  score_status: string;
  stage_id: string | null;
  stage2_at: string | null;
  evaluations: { rubric_id: string; needs_review: boolean; disqualified: boolean }[];
}

/** Show location filter and sort once a list is long enough to need them. */
const FILTERS_FROM = 6;
const count = (v: unknown) => (v as { count: number }[] | null)?.[0]?.count ?? 0;

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const view = sp.view === "closed" ? "closed" : "open";
  const q = str("q").toLowerCase();
  const loc = str("loc");
  const sort: SortKey = str("sort") in SORTS ? (str("sort") as SortKey) : "newest";
  const from = str("from") || undefined;
  const { supabase, user } = await requireUser();

  // One pass over the recruiter's jobs, candidates and upcoming interviews; everything else is computed here.
  const now = nowMs();
  const [{ data: jobRows }, { data: candRows }, { data: ivRows }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, location, status, created_at, closed_at, based_on_job_id, google_form_id, sheet_id, current_rubric_id, last_synced_at, last_sync_error, description, form_questions(count), stages(count)")
      .order("created_at", { ascending: false }),
    supabase.from("candidates").select("job_id, score_status, stage_id, stage2_at, evaluations(rubric_id, needs_review, disqualified)"),
    supabase
      .from("interviews")
      .select("job_id")
      .gte("starts_at", new Date(now).toISOString())
      .lte("starts_at", new Date(now + 7 * 864e5).toISOString()),
  ]);
  const allJobs = jobRows ?? [];

  // Per-job funnel: applied → scored → stage 2 → in the interview pipeline.
  const stats = new Map<string, JobStats>();
  const rubricOf = new Map(allJobs.map((j) => [j.id, j.current_rubric_id as string | null]));
  for (const c of (candRows ?? []) as CandStat[]) {
    const s = stats.get(c.job_id) ?? { applied: 0, scored: 0, waiting: 0, review: 0, stage2: 0, pipeline: 0, failed: 0 };
    const ev = c.evaluations.find((e) => e.rubric_id === rubricOf.get(c.job_id));
    s.applied++;
    if (ev) s.scored++;
    else if (c.score_status === "error") s.failed++;
    else s.waiting++;
    if (ev?.needs_review && !ev.disqualified) s.review++;
    if (c.stage2_at) s.stage2++;
    if (c.stage_id) s.pipeline++;
    stats.set(c.job_id, s);
  }
  const statOf = (id: string) => stats.get(id) ?? { applied: 0, scored: 0, waiting: 0, review: 0, stage2: 0, pipeline: 0, failed: 0 };

  const openJobs = allJobs.filter((j) => j.status === "open");
  const closedCount = allJobs.length - openJobs.length;
  const sum = (k: "review" | "waiting" | "stage2") => openJobs.reduce((a, j) => a + statOf(j.id)[k], 0);
  const openIds = new Set(openJobs.map((j) => j.id));
  const interviewsSoon = (ivRows ?? []).filter((i) => openIds.has(i.job_id)).length;

  const inView = allJobs.filter((j) => j.status === view);
  const locations = [...new Set(inView.map((j) => j.location?.trim()).filter(Boolean) as string[])].sort();
  const jobs = inView
    .filter((j) => !q || `${j.title} ${j.location ?? ""}`.toLowerCase().includes(q))
    .filter((j) => !loc || j.location?.trim() === loc)
    .sort((a, b) => {
      switch (sort) {
        case "oldest": return a.created_at.localeCompare(b.created_at);
        case "applicants": return statOf(b.id).applied - statOf(a.id).applied;
        case "review": return statOf(b.id).review - statOf(a.id).review;
        default: return (view === "closed" ? (b.closed_at ?? "").localeCompare(a.closed_at ?? "") : 0) || b.created_at.localeCompare(a.created_at);
      }
    });

  // Every job (open and closed) is a possible template for a new one.
  const options: JobOption[] = allJobs.map((j) => ({
    id: j.id, title: j.title, location: j.location, status: j.status, based_on_job_id: j.based_on_job_id,
    current_rubric_id: j.current_rubric_id, created_at: j.created_at, closed_at: j.closed_at,
    applicants: statOf(j.id).applied, questions: count(j.form_questions), stages: count(j.stages),
    hasDescription: Boolean(j.description?.trim()),
  }));
  const titleOf = new Map(allJobs.map((j) => [j.id, j.title]));
  const m = user.user_metadata;
  const fullName = [m.full_name, m.name].find((v): v is string => typeof v === "string" && !!v.trim());
  const firstName = fullName?.trim().split(/\s+/)[0] ?? null;


  return (
    <JobsView
      view={view}
      jobs={jobs.map((j) => ({
        id: j.id, title: j.title, location: j.location, status: j.status, created_at: j.created_at, closed_at: j.closed_at,
        google_form_id: j.google_form_id, sheet_id: j.sheet_id, current_rubric_id: j.current_rubric_id,
        last_synced_at: j.last_synced_at, last_sync_error: j.last_sync_error,
        basedOn: (j.based_on_job_id && titleOf.get(j.based_on_job_id)) || null,
        stats: statOf(j.id),
      }))}
      totals={{ review: sum("review"), waiting: sum("waiting"), stage2: sum("stage2"), interviews: interviewsSoon }}
      openCount={openJobs.length}
      closedCount={closedCount}
      totalJobs={allJobs.length}
      options={options}
      locations={locations}
      showMore={inView.length >= FILTERS_FROM}
      firstName={firstName}
      q={q}
      loc={loc}
      from={from}
      deleted={Boolean(sp.deleted)}
    />
  );
}
