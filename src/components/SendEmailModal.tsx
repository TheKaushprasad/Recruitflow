"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction } from "./Toast";
import { sendTemplated } from "@/app/actions/email";
import { fillTemplate } from "@/lib/placeholders";
import type { CandidateRow } from "@/lib/data";
import type { EmailTemplate, Stage } from "@/lib/types";

export function SendEmailModal({ jobId, jobTitle, templates, recipients, stages, onClose }: {
  jobId: string;
  jobTitle: string;
  templates: EmailTemplate[];
  recipients: CandidateRow[];
  stages: Stage[];
  onClose: (sent: boolean) => void;
}) {
  const { run, pending } = useAction();
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const tpl = templates.find((t) => t.id === tplId);
  const first = recipients[0];
  const noEmail = recipients.filter((c) => !c.email);
  const dq = recipients.filter((c) => c.evaluation?.disqualified).length;
  const stageName = first ? stages.find((s) => s.id === first.stage_id)?.name ?? "" : "";
  const values = first
    ? {
        first_name: first.name.split(/\s+/)[0],
        full_name: first.name,
        job_title: jobTitle,
        stage: stageName,
        status: first.evaluation?.disqualified ? "Not progressing" : stageName || "Under review",
        recruiter_name: "(your name)",
      }
    : {};

  return (
    <div className="scrim center" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send email">
        <div className="dhead">
          <div>
            <p className="eyebrow" style={{ margin: "0 0 6px" }}>Review before sending</p>
            <h2>Email {recipients.length} candidate{recipients.length === 1 ? "" : "s"}</h2>
          </div>
          <button className="iconbtn" onClick={() => onClose(false)} aria-label="Close">✕</button>
        </div>
        {!templates.length ? (
          <div className="empty-state" style={{ padding: 28 }}>
            <p>You don&apos;t have any email templates yet.</p>
            <Link className="pillbtn btn-dark btn-sm" href="/emails" style={{ textDecoration: "none" }}>Create a template</Link>
          </div>
        ) : (
          <form onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => sendTemplated(jobId, tplId, recipients.map((c) => c.id)));
            onClose(r.ok);
          }}>
            <div className="field">
              <label className="f" htmlFor="sendTpl">Template</label>
              <select id="sendTpl" value={tplId} onChange={(e) => setTplId(e.target.value)}>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <p className="hint" style={{ margin: "0 0 8px" }}>To: {recipients.map((c) => c.name).join(", ")}</p>
            {noEmail.length > 0 && <div className="note" style={{ margin: "0 0 12px" }}>{noEmail.map((c) => c.name).join(", ")} {noEmail.length === 1 ? "has" : "have"} no email address and will be skipped.</div>}
            {dq > 0 && <div className="note" style={{ margin: "0 0 12px" }}>{dq} of these {dq === 1 ? "is" : "are"} disqualified by a hard filter. Check the template fits.</div>}
            {tpl && first && (
              <div className="preview">
                <div className="subj">{fillTemplate(tpl.subject, values)}</div>
                {fillTemplate(tpl.body, values)}
              </div>
            )}
            <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
              <span className="hint" style={{ margin: 0 }}>Sends from your connected Gmail</span>
              <div className="row">
                <button type="button" className="pillbtn btn-ghost btn-sm" onClick={() => onClose(false)}>Cancel</button>
                <button type="submit" className="pillbtn btn-lime btn-sm" disabled={pending || !tpl}>
                  {pending ? <span className="spin" /> : `Send ${recipients.length - noEmail.length}`}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
