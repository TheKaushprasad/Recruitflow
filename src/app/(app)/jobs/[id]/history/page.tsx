import Link from "next/link";
import { providerLabel } from "@/lib/ai/provider";
import { requireUser } from "@/lib/supabase/server";
import { getJob } from "@/lib/data";

type Kind = "job" | "form" | "rubric" | "applications" | "deep" | "pipeline" | "interviews" | "emails";
interface Event { at: string; kind: Kind; title: string; detail?: string; href?: string }

const KINDS: [Kind | "all", string][] = [
  ["all", "Everything"], ["job", "Job"], ["form", "Form"], ["rubric", "Rubric"], ["applications", "Applications"],
  ["deep", "Stage 2 evaluations"], ["pipeline", "Pipeline"], ["interviews", "Interviews"], ["emails", "Emails"],
];
const VERDICT_TEXT: Record<string, string> = { strong: "strong fit", possible: "possible fit", weak: "weak fit" };

const fmt = (d: string) => new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (d: string) => new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export default async function HistoryPage({ params, searchParams }: PageProps<"/jobs/[id]/history">) {
  const { id } = await params;
  const sp = await searchParams;
  const filter = (KINDS.find(([k]) => k === sp.type)?.[0] ?? "all") as Kind | "all";
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const base = `/jobs/${id}`;

  const [parent, evs, rubrics, cands, moves, ivs, mails, deeps] = await Promise.all([
    job.based_on_job_id ? supabase.from("jobs").select("id, title").eq("id", job.based_on_job_id).maybeSingle().then((r) => r.data) : null,
    supabase.from("job_events").select("*").eq("job_id", id).then((r) => r.data ?? []),
    supabase.from("rubrics").select("id, version, status, source, created_at, approved_at").eq("job_id", id).then((r) => r.data ?? []),
    supabase.from("candidates").select("id, name, created_at, submitted_at").eq("job_id", id).then((r) => r.data ?? []),
    supabase.from("stage_moves").select("*").eq("job_id", id).order("moved_at", { ascending: false }).limit(500).then((r) => r.data ?? []),
    supabase.from("interviews").select("id, candidate_id, starts_at, created_at, duration_min, stages(name)").eq("job_id", id).then((r) => r.data ?? []),
    supabase.from("email_sends").select("id, candidate_id, subject, status, sent_at").eq("job_id", id).then((r) => r.data ?? []),
    supabase.from("deep_evaluations").select("id, candidate_id, status, score, verdict, disqualified, error, created_at, finished_at").eq("job_id", id).then((r) => r.data ?? []),
  ]);
  const nameOf = new Map(cands.map((c) => [c.id, c.name]));
  const events: Event[] = [];

  events.push({ at: job.created_at, kind: "job", title: "Job created", detail: parent ? `Based on “${parent.title}”` : undefined, href: parent ? `/jobs/${parent.id}` : undefined });
  const EV_TITLE: Record<string, string> = { closed: "Job closed", reopened: "Job reopened", form_published: "Google Form created and published", form_updated: "Google Form updated", form_linked: "Existing form linked" };
  for (const e of evs) events.push({ at: e.at, kind: e.kind.startsWith("form") ? "form" : "job", title: EV_TITLE[e.kind] ?? e.kind, detail: e.detail ?? undefined });

  for (const d of deeps) {
    const who = nameOf.get(d.candidate_id) ?? "A candidate";
    events.push({
      at: d.finished_at ?? d.created_at,
      kind: "deep",
      title:
        d.status === "done" ? `${who} evaluated on CV and links: ${d.score}${d.disqualified ? " (fails a hard filter)" : `, ${VERDICT_TEXT[d.verdict ?? ""] ?? ""}`}`
        : d.status === "error" ? `Stage 2 evaluation of ${who} failed`
        : `Stage 2 evaluation of ${who} started`,
      detail: d.status === "error" ? d.error ?? undefined : undefined,
      href: `${base}/candidates?c=${d.candidate_id}`,
    });
  }

  for (const r of rubrics) {
    events.push({ at: r.created_at, kind: "rubric", title: `Rubric v${r.version} ${r.source === "recruiter" ? "created by you" : `drafted by ${providerLabel(r.source)}`}`, href: `${base}/rubric?v=${r.version}` });
    if (r.approved_at) events.push({ at: r.approved_at, kind: "rubric", title: `Rubric v${r.version} approved`, detail: "All candidates re-scored on this version", href: `${base}/rubric?v=${r.version}` });
  }

  // Applications, grouped per day
  const byDay = new Map<string, { at: string; names: string[] }>();
  for (const c of cands) {
    const at = c.submitted_at ?? c.created_at;
    const k = at.slice(0, 10);
    const g = byDay.get(k) ?? { at, names: [] as string[] };
    g.names.push(c.name);
    if (at > g.at) g.at = at;
    byDay.set(k, g);
  }
  byDay.forEach((g) => events.push({
    at: g.at, kind: "applications",
    title: `${g.names.length} application${g.names.length === 1 ? "" : "s"} received`,
    detail: g.names.slice(0, 6).join(", ") + (g.names.length > 6 ? ` and ${g.names.length - 6} more` : ""),
    href: `${base}/candidates`,
  }));

  for (const m of moves) {
    const who = nameOf.get(m.candidate_id) ?? "A candidate";
    events.push({
      at: m.moved_at, kind: "pipeline",
      title: m.to_stage ? `${who} moved to ${m.to_stage}` : `${who} removed from the pipeline`,
      detail: m.from_stage ? `from ${m.from_stage}` : "from the ranked list",
      href: `${base}/candidates?c=${m.candidate_id}`,
    });
  }

  for (const i of ivs) {
    const stage = (i.stages as unknown as { name: string } | null)?.name ?? "Interview";
    events.push({ at: i.created_at, kind: "interviews", title: `${stage} interview booked with ${nameOf.get(i.candidate_id) ?? "a candidate"}`, detail: `For ${fmt(i.starts_at)} · ${i.duration_min} min`, href: `${base}/pipeline` });
  }

  // Emails, grouped by subject within the same minute (one bulk send)
  const batches = new Map<string, { at: string; subject: string; names: string[]; failed: number }>();
  for (const m of mails) {
    const k = `${m.sent_at.slice(0, 16)}|${m.subject}`;
    const b = batches.get(k) ?? { at: m.sent_at, subject: m.subject, names: [] as string[], failed: 0 };
    b.names.push(nameOf.get(m.candidate_id ?? "") ?? "a candidate");
    if (m.status === "failed") b.failed++;
    batches.set(k, b);
  }
  batches.forEach((b) => events.push({
    at: b.at, kind: "emails",
    title: `Email “${b.subject}” sent to ${b.names.length === 1 ? b.names[0] : `${b.names.length} candidates`}`,
    detail: (b.names.length > 1 ? b.names.join(", ") : "") + (b.failed ? `${b.names.length > 1 ? " · " : ""}${b.failed} failed` : ""),
    href: `/emails?job=${id}`,
  }));

  const shown = events.filter((e) => filter === "all" || e.kind === filter).sort((a, b) => b.at.localeCompare(a.at));
  const groups: [string, Event[]][] = [];
  for (const e of shown) {
    const d = day(e.at);
    if (groups.at(-1)?.[0] !== d) groups.push([d, []]);
    groups.at(-1)![1].push(e);
  }

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Job history</p>
          <h2>Everything that happened on this job</h2>
          <p>From the day it was created: form changes, rubric versions, applications, pipeline moves, interviews and emails.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="filters">
          {KINDS.map(([k, l]) => {
            const n = k === "all" ? events.length : events.filter((e) => e.kind === k).length;
            if (k !== "all" && !n) return null;
            return <Link key={k} href={k === "all" ? `${base}/history` : `${base}/history?type=${k}`} aria-pressed={filter === k} className="filter-link">{l} <span className="mono">{n}</span></Link>;
          })}
        </div>
      </div>
      <div className="timeline">
        {groups.map(([d, es]) => (
          <section key={d}>
            <h3 className="tl-day">{d}</h3>
            {es.map((e, i) => (
              <div className={`tl-item k-${e.kind}`} key={i}>
                <span className="tl-time mono">{new Date(e.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="tl-dot" aria-hidden="true" />
                <div className="tl-body">
                  {e.href ? <Link href={e.href}><b>{e.title}</b></Link> : <b>{e.title}</b>}
                  {e.detail && <span>{e.detail}</span>}
                </div>
              </div>
            ))}
          </section>
        ))}
        {!groups.length && <div className="empty-state"><p>Nothing of this type yet.</p></div>}
      </div>
    </>
  );
}
