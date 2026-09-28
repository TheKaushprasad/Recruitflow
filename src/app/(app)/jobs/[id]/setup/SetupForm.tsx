"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/Toast";
import { linkExistingForm, publishForm, saveJobDetails, saveQuestions } from "@/app/actions/jobs";
import { timeAgo } from "@/lib/format";
import type { FormQuestion, Job, QuestionRole, QuestionType } from "@/lib/types";

const TYPES: [QuestionType, string][] = [
  ["short", "Short answer"],
  ["paragraph", "Paragraph"],
  ["choice", "Multiple choice"],
  ["dropdown", "Dropdown"],
  ["checkbox", "Checkboxes"],
  ["date", "Date"],
];
const hasOptions = (t: QuestionType) => t === "choice" || t === "dropdown" || t === "checkbox";
const ROLES: [QuestionRole, string][] = [
  ["name", "name"],
  ["email", "email"],
  ["resume", "CV link"],
  ["portfolio", "portfolio link"],
  ["github", "GitHub profile"],
];

type Q = Pick<FormQuestion, "title" | "type" | "required" | "options" | "role"> & { key: string };

export function SetupForm({ job, questions, googleConnected, responses, aiName, ruleNotes }: {
  job: Job;
  questions: FormQuestion[];
  googleConnected: boolean;
  responses: number;
  aiName: string;
  /** screening rules per question title (lower-cased) */
  ruleNotes: Record<string, string[]>;
}) {
  const router = useRouter();
  const { run } = useAction();
  const [details, setDetails] = useState({ title: job.title, location: job.location, description: job.description, constraints: job.constraints });
  const [mode, setMode] = useState<"built" | "linked">(job.form_source);
  const [qs, setQs] = useState<Q[]>(questions.map((q) => ({ ...q, key: q.id })));
  const [qDirty, setQDirty] = useState(false);
  const [formUrl, setFormUrl] = useState(job.form_source === "linked" ? job.google_form_url ?? "" : "");
  const [sheetUrl, setSheetUrl] = useState(job.form_source === "linked" && job.sheet_id ? `https://docs.google.com/spreadsheets/d/${job.sheet_id}` : "");
  const [busy, setBusy] = useState<string | null>(null);

  const setQ = (i: number, patch: Partial<Q>) => {
    setQs((all) => all.map((q, j) => (j === i ? { ...q, ...patch } : q)));
    setQDirty(true);
  };

  async function act(name: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(name);
    const r = await run(fn);
    setBusy(null);
    if (r.ok) router.refresh();
    return r;
  }

  // Send only the question fields (never database ids or owners).
  const strip = () => qs.map(({ title, type, required, options, role }) => ({ title, type, required, options, role }));

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Job setup</p>
          <h2>One job, one rubric, one form</h2>
          <p>The rubric {aiName} builds from this description is reused for every applicant, so scores stay comparable.</p>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <div className="field"><label className="f" htmlFor="jobTitle">Job title</label>
            <input type="text" id="jobTitle" value={details.title} onChange={(e) => setDetails({ ...details, title: e.target.value })} /></div>
          <div className="field"><label className="f" htmlFor="jobLoc">Location &amp; arrangement</label>
            <input type="text" id="jobLoc" value={details.location} onChange={(e) => setDetails({ ...details, location: e.target.value })} placeholder="Bengaluru · Hybrid (3 days on-site)" /></div>
          <div className="field"><label className="f" htmlFor="jd">Job description</label>
            <textarea id="jd" rows={14} value={details.description} onChange={(e) => setDetails({ ...details, description: e.target.value })}
              placeholder="Paste the full job description: responsibilities, must-haves, nice-to-haves." /></div>
          <div className="field"><label className="f" htmlFor="cons">Additional constraints</label>
            <textarea id="cons" rows={3} value={details.constraints} onChange={(e) => setDetails({ ...details, constraints: e.target.value })}
              placeholder={"Reject if notice period is more than 60 days\nMust be able to work from the Bengaluru office 3 days a week"} />
            <p className="hint">One per line. On the Rubric tab, {aiName} turns these into stage-1 filters on the form answers, e.g. “reject if notice period is more than 60 days”.</p></div>
          <div className="row">
            <button className="pillbtn btn-dark" disabled={!!busy} onClick={() => act("save", () => saveJobDetails(job.id, details))}>
              {busy === "save" ? <span className="spin" /> : "Save"}
            </button>
            <Link href={`/jobs/${job.id}/rubric`} className="hint" style={{ margin: 0 }}>Set up the stage 1 and stage 2 rubric →</Link>
          </div>
        </div>

        <div className="panel">
          <h3 style={{ marginBottom: 12 }}>Application form</h3>
          {!googleConnected && (
            <div className="banner" style={{ marginBottom: 16 }}>
              <div className="txt">Connect your Google account to create a form or read responses.</div>
              <Link className="pillbtn btn-dark btn-sm" href="/integrations" style={{ textDecoration: "none" }}>Connect Google</Link>
            </div>
          )}
          <div className="seg" role="group" aria-label="Form source">
            <button aria-pressed={mode === "built"} onClick={() => setMode("built")}>Build it here</button>
            <button aria-pressed={mode === "linked"} onClick={() => setMode("linked")}>Link an existing form</button>
          </div>

          {mode === "built" ? (
            <>
              {qs.map((q, i) => (
                <div key={q.key} style={{ borderBottom: "1px solid var(--line)" }}>
                  <div className="q" style={{ borderBottom: 0 }}>
                    <input type="text" id={`q-${q.key}`} value={q.title} aria-label={`Question ${i + 1}`} onChange={(e) => setQ(i, { title: e.target.value })} />
                    <select id={`qt-${q.key}`} value={q.type} aria-label="Question type" onChange={(e) => setQ(i, { type: e.target.value as QuestionType })}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <label className="req"><input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Req.</label>
                    <button className="iconbtn" aria-label="Remove question" onClick={() => { setQs(qs.filter((_, j) => j !== i)); setQDirty(true); }}>✕</button>
                  </div>
                  {hasOptions(q.type) && (
                    <div style={{ padding: "0 0 10px 8px" }}>
                      <input type="text" id={`qo-${q.key}`} aria-label="Options" value={q.options.join(", ")} placeholder="Options, separated by commas"
                        onChange={(e) => setQ(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                    </div>
                  )}
                  {(ruleNotes[q.title.trim().toLowerCase()] ?? []).map((n) => (
                    <p key={n} className="hint" style={{ margin: "0 0 6px 8px" }}>
                      <span className="chip lime" style={{ fontSize: 11 }}>Screening rule</span> {n}{" "}
                      <Link href={`/jobs/${job.id}/rubric`}>Edit</Link>
                    </p>
                  ))}
                  <div className="row" style={{ gap: 8, margin: "0 0 8px 8px" }}>
                    <label className="hint" htmlFor={`qrole-${q.key}`} style={{ margin: 0 }}>Answer is the candidate&apos;s</label>
                    <select id={`qrole-${q.key}`} value={q.role ?? ""} style={{ width: "auto", padding: "4px 8px", fontSize: 12.5 }}
                      onChange={(e) => {
                        const role = (e.target.value || null) as QuestionRole | null;
                        // a role belongs to one question only
                        setQs((all) => all.map((x, j) => (j === i ? { ...x, role } : role && x.role === role ? { ...x, role: null } : x)));
                        setQDirty(true);
                      }}>
                      <option value="">— (just an answer)</option>
                      {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="pillbtn btn-ghost btn-sm" onClick={() => { setQs([...qs, { key: crypto.randomUUID(), title: "New question", type: "short", required: false, options: [], role: null }]); setQDirty(true); }}>+ Add question</button>
                <span className="spacer" />
                <button className="pillbtn btn-lime btn-sm" disabled={!!busy || !googleConnected}
                  onClick={async () => {
                    if (qDirty) {
                      const r = await act("q", () => saveQuestions(job.id, strip()));
                      if (!r.ok) return;
                      setQDirty(false);
                    }
                    await act("publish", () => publishForm(job.id));
                  }}>
                  {busy === "publish" || busy === "q" ? <span className="spin" /> : job.form_source === "built" && job.google_form_id ? "Save & update Google Form" : "Create Google Form"}
                </button>
              </div>
              <div className="note">
                Ask for the CV as a link to a PDF (Google Drive or Dropbox) shared as “Anyone with the link” — that&apos;s what stage 2 reads.
                The Forms API can&apos;t hand back file-upload answers as readable files. Mark the CV, portfolio and GitHub questions above so their answers are picked up.
              </div>
              {job.form_source === "built" && job.google_form_id && (
                <div className="status-box">
                  <div className="row"><span className="live" /><b>Form live</b><span className="muted">· {responses} response{responses === 1 ? "" : "s"} · synced {timeAgo(job.last_synced_at)}</span></div>
                  {job.google_form_url && <div>Share this link in your LinkedIn post: <a href={job.google_form_url} target="_blank" rel="noreferrer" className="mono" style={{ wordBreak: "break-all" }}>{job.google_form_url}</a></div>}
                  <div className="muted">Editing questions here and clicking update replaces the questions on the live form.</div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="field"><label className="f" htmlFor="lf">Google Form link (optional)</label>
                <input type="text" id="lf" placeholder="https://docs.google.com/forms/d/…/edit" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} /></div>
              <div className="field"><label className="f" htmlFor="ls">Response Sheet link</label>
                <input type="text" id="ls" placeholder="https://docs.google.com/spreadsheets/d/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
                <p className="hint">In your form, open Responses → Link to Sheets, then paste that sheet&apos;s link here. reqroot only reads this one sheet.</p></div>
              <button className="pillbtn btn-lime btn-sm" disabled={!!busy || !googleConnected} onClick={() => act("link", () => linkExistingForm(job.id, formUrl, sheetUrl))}>
                {busy === "link" ? <span className="spin" /> : "Link form & sheet"}
              </button>
              {job.form_source === "linked" && job.sheet_id && (
                <div className="status-box">
                  <div className="row"><span className="live" /><b>Linked</b><span className="muted">· {responses} response{responses === 1 ? "" : "s"} · synced {timeAgo(job.last_synced_at)}</span></div>
                </div>
              )}
            </>
          )}
          {job.last_sync_error && <p className="error-text" style={{ marginTop: 12 }}>Last sync failed: {job.last_sync_error}</p>}
        </div>
      </div>
    </>
  );
}
