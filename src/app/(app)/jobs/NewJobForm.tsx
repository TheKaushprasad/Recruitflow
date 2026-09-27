"use client";

import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createJob } from "@/app/actions/jobs";
import { relatedJobs } from "@/lib/related";

export interface JobOption {
  id: string;
  title: string;
  location: string;
  status: "open" | "closed";
  based_on_job_id: string | null;
  current_rubric_id: string | null;
  created_at: string;
  closed_at: string | null;
  applicants: number;
  questions: number;
  stages: number;
  hasDescription: boolean;
}

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

function Submit({ copying }: { copying: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="pillbtn btn-lime" type="submit" disabled={pending}>
      {pending ? <span className="spin" /> : copying ? "Create from template" : "Create job"}
    </button>
  );
}

export function NewJobForm({ jobs, initialSource }: { jobs: JobOption[]; initialSource?: string }) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [sourceId, setSourceId] = useState(initialSource && jobs.some((j) => j.id === initialSource) ? initialSource : "");
  const source = jobs.find((j) => j.id === sourceId);
  const suggestions = useMemo(
    () => (title.trim().length >= 3 ? relatedJobs({ title }, jobs, 4).filter((r) => r.job.id !== sourceId) : []),
    [title, jobs, sourceId],
  );

  return (
    <form action={createJob} style={{ display: "grid", gap: 16 }}>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: "2 1 240px" }}>
          <label className="f" htmlFor="title">Job title</label>
          <input id="title" name="title" type="text" required placeholder="Senior Frontend Engineer" value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="off" />
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label className="f" htmlFor="location">Location</label>
          <input id="location" name="location" type="text" placeholder={source?.location || "Bengaluru · Hybrid"} value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>
        <div style={{ flex: "1.4 1 220px" }}>
          <label className="f" htmlFor="source_job_id">Start from</label>
          <select id="source_job_id" name="source_job_id" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Blank job</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}{j.status === "closed" ? ` (closed ${fmt(j.closed_at)})` : ""}</option>
            ))}
          </select>
        </div>
        <Submit copying={!!source} />
      </div>

      {suggestions.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          <span className="hint" style={{ margin: 0 }}>Related past jobs:</span>
          {suggestions.map(({ job }) => (
            <button type="button" key={job.id} className="chip neutral" style={{ border: 0, cursor: "pointer" }} onClick={() => setSourceId(job.id)}>
              Use “{job.title}” · {job.applicants} applicants{job.status === "closed" ? " · closed" : ""}
            </button>
          ))}
        </div>
      )}

      {source && (
        <div className="status-box" style={{ marginTop: 0 }}>
          <div>
            <b>Copying from {source.title}</b>
            <span className="muted"> · created {fmt(source.created_at)}{source.closed_at ? ` · closed ${fmt(source.closed_at)}` : ""} · {source.applicants} applicants</span>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="copy_details" defaultChecked={source.hasDescription} disabled={!source.hasDescription} /> Description &amp; constraints
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="copy_questions" defaultChecked /> Form questions ({source.questions})
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="copy_stages" defaultChecked /> Pipeline stages ({source.stages})
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="copy_rubric" defaultChecked={!!source.current_rubric_id} disabled={!source.current_rubric_id} /> Approved rubric
            </label>
          </div>
          <span className="muted">
            The new job gets its own Google Form and starts with no candidates. A copied rubric arrives as a draft, so you review and approve it before anyone is scored.
          </span>
        </div>
      )}
    </form>
  );
}
