import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getCandidates, getInterviews, getJob, getRelatedJobs, getRubrics, getStages } from "@/lib/data";
import { RelatedJobs } from "@/components/RelatedJobs";
import { SyncButton } from "@/components/SyncButton";
import { nowMs, timeAgo } from "@/lib/format";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

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
  const scored = cands.filter((c) => c.evaluation && !c.stale);
  const qualified = scored.filter((c) => !c.evaluation!.disqualified);
  const strong = qualified.filter((c) => c.evaluation!.score >= 75).length;
  const inPipeline = cands.filter((c) => c.stage_id).length;
  const review = scored.filter((c) => c.evaluation!.needs_review).length;
  const now = nowMs(); // request time (server component)
  const weekEnd = now + 7 * 864e5;
  const upcoming = interviews.filter((i) => {
    const t = new Date(i.starts_at).getTime();
    return t > now && t < weekEnd;
  }).length;
  const rechecked = scored.filter((c) => c.evaluation!.criterion_results.some((r) => r.initial_confidence != null)).length;
  const pending = cands.filter((c) => !c.evaluation || c.stale).length;
  const errors = cands.filter((c) => c.score_status === "error").length;
  const hasForm = Boolean(job.google_form_id || job.sheet_id);
  const calStages = new Set(stages.filter((s) => s.prompt_calendar).map((s) => s.id));
  const threshold = Number(job.recheck_threshold);

  const attn: { sev?: "bad"; title: string; detail: string; href: string; cta: string }[] = [];
  if (!job.description.trim()) attn.push({ title: "Add the job description", detail: "Claude builds the scoring rubric from it.", href: `${base}/setup`, cta: "Open job setup" });
  if (!hasForm) attn.push({ title: "No application form yet", detail: "Build one here or link an existing Google Form and its response Sheet.", href: `${base}/setup`, cta: "Set up form" });
  if (!rubrics.current) attn.push({ title: rubrics.draft ? "Draft rubric waiting for your approval" : "No rubric yet", detail: "Nobody is scored until a rubric is approved.", href: `${base}/rubric`, cta: "Review rubric" });
  else if (rubrics.draft) attn.push({ title: `Rubric v${rubrics.draft.version} has unapproved changes`, detail: `Scores still use v${rubrics.current.version}.`, href: `${base}/rubric`, cta: "Review changes" });
  if (job.last_sync_error) attn.push({ sev: "bad", title: "Couldn't read new responses", detail: job.last_sync_error, href: "/integrations", cta: "Check integrations" });
  if (errors) attn.push({ sev: "bad", title: `${errors} candidate${errors === 1 ? "" : "s"} failed to score`, detail: "Open Candidates and retry them.", href: `${base}/candidates?f=error`, cta: "View" });
  for (const c of scored.filter((c) => c.evaluation!.disqualified && c.evaluation!.score >= 80))
    attn.push({ sev: "bad", title: `${c.name} would rank near the top but fails a hard filter`, detail: c.evaluation!.reason, href: `${base}/candidates?c=${c.id}`, cta: "View evidence" });
  for (const c of scored.filter((c) => c.evaluation!.needs_review))
    attn.push({ title: `${c.name}: low confidence even after Claude's recheck`, detail: `At least one criterion is below ${threshold.toFixed(2)}. Read the evidence before deciding.`, href: `${base}/candidates?c=${c.id}`, cta: "View evidence" });
  for (const c of cands.filter((c) => c.stage_id && calStages.has(c.stage_id) && !interviews.some((i) => i.candidate_id === c.id && i.stage_id === c.stage_id)))
    attn.push({ title: `${c.name} has no interview booked for ${stages.find((s) => s.id === c.stage_id)?.name}`, detail: "Schedule it from their pipeline card.", href: `${base}/pipeline`, cta: "Open pipeline" });

  return (
    <>
      <div className="hero-grid">
        <div>
          <p className="eyebrow">{job.title}{job.location ? ` · ${job.location}` : ""}</p>
          <h1 className="hero">
            {scored.length ? `${scored.length} applicants ranked. ${strong} worth a conversation.` : "Waiting for your first applicants."}
          </h1>
          <p className="lede">
            Every candidate is scored against the same rubric, criterion by criterion, with the evidence behind each decision. Nothing is sent without your say-so.
          </p>
          <div className="row">
            <Link className="pillbtn btn-lime" href={`${base}/candidates`} style={{ textDecoration: "none" }}>Review ranked candidates</Link>
            <Link className="pillbtn btn-ghost" href={`${base}/pipeline`} style={{ textDecoration: "none" }}>Open pipeline</Link>
          </div>
        </div>
        <div className="pulse">
          <div className="big">
            <div style={{ fontSize: 14 }}>Today&apos;s hiring pulse</div>
            <div className="n mono">{String(inPipeline).padStart(2, "0")}</div>
            <div style={{ fontSize: 14 }}>candidates in your interview pipeline</div>
          </div>
          <div className="pair">
            <Link className="tile mint" href={`${base}/candidates?f=review`} style={{ textDecoration: "none" }}>
              <div className="n mono">{String(review).padStart(2, "0")}</div>
              <div style={{ fontSize: 13.5 }}>Need recruiter review</div>
            </Link>
            <Link className="tile peach" href={`${base}/pipeline`} style={{ textDecoration: "none" }}>
              <div className="n mono">{String(upcoming).padStart(2, "0")}</div>
              <div style={{ fontSize: 13.5 }}>Interviews in the next 7 days</div>
            </Link>
          </div>
          <p>Jev scores each criterion. Claude rechecks anything under {threshold.toFixed(2)} confidence. You make every call.</p>
        </div>
      </div>

      <hr className="rule" />
      <p className="eyebrow">This job, end to end</p>
      <div className="steps">
        <Link className="step" href={`${base}/setup`} style={{ textDecoration: "none" }}>
          <span className="k">01</span><h3>Capture</h3>
          <p>Responses sync from your Google Form as they arrive.</p>
          <span className="st">{hasForm ? <><span className="live" /> Synced {timeAgo(job.last_synced_at)}</> : "Not connected"}</span>
        </Link>
        <Link className="step" href={`${base}/rubric`} style={{ textDecoration: "none" }}>
          <span className="k">02</span><h3>Understand</h3>
          <p>Claude turns the job description and your constraints into one rubric.</p>
          <span className="st">
            {rubrics.current
              ? `Rubric v${rubrics.current.version} · ${rubrics.current.rubric_criteria.filter((c) => c.kind === "soft").length} criteria, ${rubrics.current.rubric_criteria.filter((c) => c.kind === "hard").length} filters`
              : "Not approved yet"}
          </span>
        </Link>
        <Link className="step" href={`${base}/candidates`} style={{ textDecoration: "none" }}>
          <span className="k">03</span><h3>Evaluate</h3>
          <p>Each answer is scored per criterion, with evidence you can audit.</p>
          <span className="st">{scored.length} scored · {rechecked} rechecked{pending ? ` · ${pending} pending` : ""}</span>
        </Link>
        <Link className="step" href={`${base}/pipeline`} style={{ textDecoration: "none" }}>
          <span className="k">04</span><h3>Schedule</h3>
          <p>Move people through your stages and book interviews from the card.</p>
          <span className="st">{interviews.length} interview{interviews.length === 1 ? "" : "s"} booked</span>
        </Link>
      </div>

      <hr className="rule" />
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Needs you</p>
          <h2>{attn.length ? `${attn.length} thing${attn.length === 1 ? "" : "s"} before your next shortlist` : "All clear"}</h2>
        </div>
        <div className="row">
          <Link className="pillbtn btn-ghost btn-sm" href={`/emails?job=${id}`} style={{ textDecoration: "none" }}>Email history</Link>
          {hasForm && job.status === "open" && <SyncButton jobId={id} />}
        </div>
      </div>
      <div className="attn">
        {attn.length ? (
          attn.map((a, i) => (
            <div className="attn-item" key={i}>
              <span className={`sev ${a.sev ?? ""}`} />
              <div className="txt"><b>{a.title}</b><span>{a.detail}</span></div>
              <Link className="pillbtn btn-ghost btn-sm" href={a.href} style={{ textDecoration: "none" }}>{a.cta}</Link>
            </div>
          ))
        ) : (
          <div className="attn-item"><div className="txt"><b>Nothing needs your attention.</b><span>New responses are scored automatically.</span></div></div>
        )}
      </div>

      <hr className="rule" />
      <RelatedJobs jobId={id} related={related} />
    </>
  );
}
