import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { TemplateEditor } from "./TemplateEditor";
import { JobFilter } from "./JobFilter";
import type { EmailSend, EmailTemplate } from "@/lib/types";

const STARTERS = [
  {
    name: "Screening invite",
    subject: "{{job_title}} — let's talk",
    body: "Hi {{first_name}},\n\nThanks for applying for the {{job_title}} role. Your experience stood out and we'd like to invite you to a 30-minute screening call.\n\nI'll send a calendar invite shortly — reply here if the time doesn't work.\n\nBest,\n{{recruiter_name}}",
  },
  {
    name: "Moving to next round",
    subject: "Next step: {{stage}}",
    body: "Hi {{first_name}},\n\nGood news — we'd like to move you forward to the {{stage}} stage for {{job_title}}.\n\nYou'll receive a calendar invite with the details. Let me know if you have any questions.\n\nBest,\n{{recruiter_name}}",
  },
  {
    name: "Not moving forward",
    subject: "Your application for {{job_title}}",
    body: "Hi {{first_name}},\n\nThank you for your interest in the {{job_title}} role and for the time you put into your application.\n\nAfter careful review, we won't be moving forward at this stage. We'd be glad to stay in touch for future openings.\n\nBest,\n{{recruiter_name}}",
  },
];

export default async function EmailsPage({ searchParams }: PageProps<"/emails">) {
  const sp = await searchParams;
  const jobFilter = typeof sp.job === "string" ? sp.job : "";
  const statusFilter = sp.status === "failed" ? "failed" : "";
  const { supabase } = await requireUser();
  let { data: templates } = await supabase.from("email_templates").select("*").order("created_at");
  if (!templates?.length) {
    await supabase.from("email_templates").insert(STARTERS);
    ({ data: templates } = await supabase.from("email_templates").select("*").order("created_at"));
  }
  const { data: jobs } = await supabase.from("jobs").select("id, title, status").order("created_at", { ascending: false });
  let hq = supabase
    .from("email_sends")
    .select("id, job_id, to_email, subject, status, error, sent_at, candidate_id, candidates(name)", { count: "exact" })
    .order("sent_at", { ascending: false })
    .limit(200);
  if (jobFilter === "none") hq = hq.is("job_id", null);
  else if (jobFilter) hq = hq.eq("job_id", jobFilter);
  if (statusFilter) hq = hq.eq("status", statusFilter);
  const { data: history, count } = await hq;
  const jobTitle = new Map((jobs ?? []).map((j) => [j.id, j.title]));

  return (
    <>
      <TemplateEditor templates={(templates ?? []) as EmailTemplate[]} />
      <div className="section-head" style={{ margin: "40px 0 12px", alignItems: "center" }}>
        <h3>Send history <span className="mono muted" style={{ fontWeight: 400, fontSize: 14 }}>{count ?? 0}</span></h3>
        <JobFilter jobs={(jobs ?? []).map((j) => ({ id: j.id, title: j.title, closed: j.status === "closed" }))} job={jobFilter} status={statusFilter} />
      </div>
      <div className="tablewrap">
        <table style={{ minWidth: 720 }}>
          <thead><tr><th>When</th><th>To</th><th>Job</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>
            {history?.length ? (history as unknown as (EmailSend & { candidates: { name: string } | null })[]).map((h) => (
              <tr key={h.id} style={{ cursor: "default" }}>
                <td className="mono">{new Date(h.sent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td><b>{h.candidates?.name ?? h.to_email}</b><div className="hint" style={{ margin: 0 }}>{h.to_email}</div></td>
                <td>{h.job_id && jobTitle.get(h.job_id) ? <Link href={`/jobs/${h.job_id}/candidates${h.candidate_id ? `?c=${h.candidate_id}` : ""}`}>{jobTitle.get(h.job_id)}</Link> : <span className="muted">—</span>}</td>
                <td>{h.subject}</td>
                <td>{h.status === "sent" ? <span className="chip good">Sent</span> : <span className="chip bad" title={h.error ?? ""}>Failed</span>}
                  {h.error && <div className="hint" style={{ margin: "4px 0 0" }}>{h.error}</div>}</td>
              </tr>
            )) : <tr><td colSpan={5} className="muted">{jobFilter || statusFilter ? "No emails match these filters." : "Nothing sent yet. Pick candidates on a job's shortlist and choose Email."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
