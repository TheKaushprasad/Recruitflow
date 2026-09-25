import Link from "next/link";
import type { RelatedJobSummary } from "@/lib/data";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

const RELATION_LABEL: Record<RelatedJobSummary["relation"], string> = {
  template: "This job was created from it",
  "created from this": "Created from this job",
  "same template": "Same template",
  "similar title": "Similar role",
};

export function RelatedJobs({ jobId, related }: { jobId: string; related: RelatedJobSummary[] }) {
  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Related jobs</p>
          <h2>{related.length ? `${related.length} similar posting${related.length === 1 ? "" : "s"}` : "No related jobs yet"}</h2>
          <p>Past and current jobs with the same template or a similar title, and how hiring went there.</p>
        </div>
        <Link className="pillbtn btn-ghost btn-sm" href={`/jobs?from=${jobId}`} style={{ textDecoration: "none" }}>Create similar job</Link>
      </div>
      {related.length > 0 && (
        <div className="tablewrap">
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr><th>Job</th><th>Relation</th><th>Dates</th><th>Applicants</th><th>Qualified</th><th>Avg score</th><th>Reached final stage</th><th>Interviews</th></tr>
            </thead>
            <tbody>
              {related.map((r) => (
                <tr key={r.id} style={{ cursor: "default" }}>
                  <td className="who">
                    <Link href={`/jobs/${r.id}`}><b>{r.title}</b></Link>
                    <span>{r.location}</span>
                  </td>
                  <td><span className="chip neutral">{RELATION_LABEL[r.relation]}</span></td>
                  <td className="mono" style={{ fontSize: 13 }}>
                    {fmt(r.created_at)}
                    <div className="muted">{r.status === "closed" ? `closed ${fmt(r.closed_at)}` : "open"}</div>
                  </td>
                  <td className="mono">{r.applicants}</td>
                  <td className="mono">{r.qualified}</td>
                  <td className="mono">{r.avgScore ?? "—"}</td>
                  <td>{r.finalStage ? <><span className="mono">{r.reachedFinal}</span> <span className="muted">in {r.finalStage}</span></> : "—"}</td>
                  <td className="mono">{r.interviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
