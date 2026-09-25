"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { googleFor } from "@/lib/google/auth";
import { sendEmail } from "@/lib/google/gmail";
import { fillTemplate, unfilled } from "@/lib/placeholders";
import type { Candidate, EmailTemplate } from "@/lib/types";
import type { ActionResult } from "./jobs";

export async function saveTemplate(t: Pick<EmailTemplate, "name" | "subject" | "body"> & { id?: string }): Promise<ActionResult & { id?: string }> {
  const { supabase } = await requireUser();
  if (!t.name.trim() || !t.subject.trim() || !t.body.trim()) return { ok: false, error: "A template needs a name, subject and body." };
  const row = { name: t.name.trim(), subject: t.subject, body: t.body };
  const q = t.id
    ? supabase.from("email_templates").update(row).eq("id", t.id).select("id").single()
    : supabase.from("email_templates").insert(row).select("id").single();
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  revalidatePath("/emails");
  return { ok: true, message: "Template saved", id: data.id };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  await supabase.from("email_templates").delete().eq("id", id);
  revalidatePath("/emails");
  return { ok: true, message: "Template deleted" };
}

/** Sends one templated email per candidate from the recruiter's Gmail. Always user-initiated. */
export async function sendTemplated(jobId: string, templateId: string, candidateIds: string[]): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    if (!candidateIds.length) return { ok: false, error: "Select at least one candidate." };
    if (candidateIds.length > 50) return { ok: false, error: "Send to 50 or fewer candidates at a time." };
    const { data: tpl } = await supabase.from("email_templates").select("*").eq("id", templateId).single<EmailTemplate>();
    const { data: job } = await supabase.from("jobs").select("title, current_rubric_id").eq("id", jobId).single();
    const { data: cands } = await supabase
      .from("candidates")
      .select("*, stages(name), evaluations(rubric_id, disqualified)")
      .in("id", candidateIds);
    if (!tpl || !job) return { ok: false, error: "Template or job not found." };

    const recruiterName = (user.user_metadata?.full_name as string | undefined) ?? user.email?.split("@")[0] ?? "";
    const { auth } = await googleFor(user.id);
    let sent = 0;
    const failures: string[] = [];
    for (const c of (cands ?? []) as (Candidate & { stages: { name: string } | null; evaluations: { rubric_id: string; disqualified: boolean }[] })[]) {
      const ev = c.evaluations.find((e) => e.rubric_id === job.current_rubric_id);
      const values = {
        first_name: c.name.split(/\s+/)[0] ?? c.name,
        full_name: c.name,
        job_title: job.title,
        stage: c.stages?.name ?? "",
        status: ev?.disqualified ? "Not progressing" : c.stages?.name ?? "Under review",
        recruiter_name: recruiterName,
      };
      const subject = fillTemplate(tpl.subject, values);
      const body = fillTemplate(tpl.body, values);
      const leftover = unfilled(subject + body);
      let status: "sent" | "failed" = "failed";
      let error: string | null = null;
      let messageId: string | null = null;
      if (!c.email) error = "No email address on the application";
      else if (leftover.length) error = `Unknown placeholder: {{${leftover[0]}}}`;
      else {
        try {
          messageId = await sendEmail(auth, { to: c.email, subject, body });
          status = "sent";
          sent++;
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
      if (error) failures.push(`${c.name}: ${error}`);
      await supabase.from("email_sends").insert({
        job_id: jobId,
        candidate_id: c.id, template_id: tpl.id, to_email: c.email ?? "", subject, body,
        status, error, gmail_message_id: messageId,
      });
    }
    revalidatePath("/emails");
    revalidatePath(`/jobs/${jobId}`, "layout");
    if (failures.length) return { ok: false, error: `Sent ${sent}. Not sent — ${failures.join("; ")}` };
    return { ok: true, message: `Sent ${sent} email${sent === 1 ? "" : "s"} from your Gmail.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
