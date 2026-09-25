import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { getJob, getRubrics } from "@/lib/data";
import { RubricEditor } from "./RubricEditor";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default async function RubricPage({ params, searchParams }: PageProps<"/jobs/[id]/rubric">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const { current, draft, all } = await getRubrics(supabase, job);
  const { count } = await supabase.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", id);

  // How many candidates were scored on each version (audit trail).
  const { data: evals } = all.length
    ? await supabase.from("evaluations").select("rubric_id").in("rubric_id", all.map((r) => r.id))
    : { data: [] as { rubric_id: string }[] };
  const scoredOn = new Map<string, number>();
  (evals ?? []).forEach((e) => scoredOn.set(e.rubric_id, (scoredOn.get(e.rubric_id) ?? 0) + 1));

  const requested = typeof sp.v === "string" ? all.find((r) => String(r.version) === sp.v) : undefined;
  const viewingOld = requested && requested.id !== current?.id && requested.id !== draft?.id ? requested : null;
  const base = `/jobs/${id}/rubric`;

  return (
    <>
      {viewingOld ? (
        <OldVersion rubric={viewingOld} scored={scoredOn.get(viewingOld.id) ?? 0} back={base} />
      ) : (
        <RubricEditor job={job} current={current} draft={draft} candidateCount={count ?? 0} />
      )}

      {all.length > 0 && (
        <section style={{ marginTop: 40 }}>
          <h3 style={{ marginBottom: 6 }}>Version history</h3>
          <p className="hint" style={{ margin: "0 0 12px" }}>Every rubric version is kept, so any past score can be traced to the criteria that produced it.</p>
          <div className="versions">
            {all.map((r) => {
              const isShown = viewingOld ? r.id === viewingOld.id : r.id === (draft ?? current)?.id;
              const href = r.id === current?.id || r.id === draft?.id ? base : `${base}?v=${r.version}`;
              return (
                <Link key={r.id} href={href} aria-current={isShown}>
                  <b className="mono">v{r.version}</b>
                  <span className={`chip ${r.status === "approved" ? "good" : r.status === "draft" ? "warn" : "neutral"}`}>
                    {r.status === "approved" ? "In use" : r.status === "draft" ? "Draft" : "Superseded"}
                  </span>
                  <span className="muted">{r.source === "claude" ? "Drafted by Claude" : "Edited by you"}</span>
                  <span className="muted">{r.approved_at ? `Approved ${fmt(r.approved_at)}` : `Created ${fmt(r.created_at)}`}</span>
                  <span className="spacer" />
                  <span className="mono muted">{scoredOn.get(r.id) ?? 0} scored</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function OldVersion({ rubric, scored, back }: {
  rubric: Awaited<ReturnType<typeof getRubrics>>["all"][number];
  scored: number;
  back: string;
}) {
  const hard = rubric.rubric_criteria.filter((c) => c.kind === "hard");
  const soft = rubric.rubric_criteria.filter((c) => c.kind === "soft");
  const total = soft.filter((c) => c.enabled).reduce((a, c) => a + c.weight, 0);
  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Rubric v{rubric.version} · {rubric.status === "draft" ? "draft" : "superseded"}</p>
          <h2>A past version of this rubric</h2>
          <p>
            Read-only. {scored} candidate{scored === 1 ? " was" : "s were"} scored on this version
            {rubric.approved_at ? `, approved ${fmt(rubric.approved_at)}` : ""}. {rubric.bias_reviewed ? "Bias review was confirmed." : ""}
          </p>
        </div>
        <Link className="pillbtn btn-ghost btn-sm" href={back} style={{ textDecoration: "none" }}>Back to current rubric</Link>
      </div>
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 6 }}>Hard filters</h3>
        {hard.length ? hard.map((h) => (
          <div className="hard" key={h.id}>
            <span className={`chip ${h.enabled ? "good" : "neutral"}`}>{h.enabled ? "On" : "Off"}</span>
            <div className="x">
              <b>{h.name}</b>
              <div className="src">{h.description}</div>
              {h.source_constraint && <div className="src">From constraint: “{h.source_constraint}”</div>}
            </div>
          </div>
        )) : <p className="muted" style={{ fontSize: 14 }}>None.</p>}
      </div>
      <div className="panel">
        <h3 style={{ marginBottom: 6 }}>Scored criteria</h3>
        {soft.map((c) => (
          <div className="crit" key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
            <div>
              <b>{c.name}</b>
              <p className="desc">{c.description}</p>
              {c.bias_flag && <div className="flag">⚑ {c.bias_flag}</div>}
            </div>
            <span className="mono">{total && c.enabled ? Math.round((c.weight / total) * 100) : 0}%</span>
            <span className="muted" style={{ fontSize: 13 }}>{c.enabled ? "" : "Not used"}</span>
          </div>
        ))}
      </div>
    </>
  );
}
