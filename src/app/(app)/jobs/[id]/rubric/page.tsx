import Link from "next/link";
import { providerLabel } from "@/lib/ai/provider";
import { requireUser } from "@/lib/supabase/server";
import { getJob, getRubrics, getRuleQuestions } from "@/lib/data";
import { ACTION_LABEL, describeRule } from "@/lib/rules";
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
  const [{ current, draft, all }, questions] = await Promise.all([getRubrics(supabase, job), getRuleQuestions(supabase, id)]);
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
        <RubricEditor job={job} current={current} draft={draft} candidateCount={count ?? 0} questions={questions} />
      )}

      {all.length > 0 && (
        <details className="versions-box" open={!!viewingOld}>
          <summary>
            <b>Version history</b>
            <span className="muted">{all.length} version{all.length === 1 ? "" : "s"} · latest v{all[0].version} ({all[0].status === "approved" ? "live" : all[0].status === "draft" ? "draft" : "superseded"})</span>
            <span className="spacer" />
            <span className="muted" aria-hidden="true">▾</span>
          </summary>
          <p className="hint" style={{ margin: "10px 0 12px" }}>Every rubric version is kept, so any past score can be traced to the criteria that produced it.</p>
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
                  <span className="muted">{r.source === "recruiter" ? "Edited by you" : `Drafted by ${providerLabel(r.source)}`}</span>
                  <span className="muted">{r.approved_at ? `Approved ${fmt(r.approved_at)}` : `Created ${fmt(r.created_at)}`}</span>
                  <span className="spacer" />
                  <span className="mono muted">{scoredOn.get(r.id) ?? 0} scored</span>
                </Link>
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}

function OldVersion({ rubric, scored, back }: {
  rubric: Awaited<ReturnType<typeof getRubrics>>["all"][number];
  scored: number;
  back: string;
}) {
  const all = rubric.rubric_criteria;
  const rules = all.filter((c) => c.kind === "rule" && c.rule);
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
      <p className="eyebrow">Stage 1 · Form screening</p>
      <div className="panel" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 6 }}>Filters on form answers</h3>
        {rules.length ? rules.map((r) => (
          <div className="hard" key={r.id}>
            <span className={`chip ${r.enabled ? "good" : "neutral"}`}>{r.enabled ? "On" : "Off"}</span>
            <div className="x">
              <b>{r.name}</b>
              <div className="src">{describeRule(r.rule!)} → {ACTION_LABEL[r.rule!.action].toLowerCase()}</div>
              {r.source_constraint && <div className="src">From constraint: “{r.source_constraint}”</div>}
            </div>
          </div>
        )) : <p className="muted" style={{ fontSize: 14 }}>None.</p>}
      </div>
      <ReadOnlyCriteria title="AI-judged filters" rows={all.filter((c) => c.stage === 1 && c.kind === "hard")} />
      <ReadOnlyCriteria title="Scored criteria for free-text answers" rows={all.filter((c) => c.stage === 1 && c.kind === "soft")} />
      <p className="eyebrow" style={{ marginTop: 28 }}>Stage 2 · CV, portfolio &amp; GitHub</p>
      <ReadOnlyCriteria title="Must-haves" rows={all.filter((c) => c.stage === 2 && c.kind === "hard")} />
      <ReadOnlyCriteria title="Scored criteria" rows={all.filter((c) => c.stage === 2 && c.kind === "soft")} />
    </>
  );
}

function ReadOnlyCriteria({ title, rows }: { title: string; rows: Awaited<ReturnType<typeof getRubrics>>["all"][number]["rubric_criteria"] }) {
  const total = rows.filter((c) => c.enabled && c.kind === "soft").reduce((a, c) => a + c.weight, 0);
  return (
    <div className="panel" style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 6 }}>{title}</h3>
      {rows.length ? rows.map((c) => (
        <div className="crit" key={c.id} style={{ opacity: c.enabled ? 1 : 0.5 }}>
          <div>
            <b>{c.name}</b>
            <p className="desc">{c.description}</p>
            {c.bias_flag && <div className="flag">⚑ {c.bias_flag}</div>}
          </div>
          <span className="mono">{c.kind === "soft" ? `${total && c.enabled ? Math.round((c.weight / total) * 100) : 0}%` : ""}</span>
          <span className="muted" style={{ fontSize: 13 }}>{c.enabled ? "" : "Not used"}</span>
        </div>
      )) : <p className="muted" style={{ fontSize: 14 }}>None.</p>}
    </div>
  );
}
