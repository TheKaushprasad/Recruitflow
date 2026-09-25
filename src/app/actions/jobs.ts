"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleFor } from "@/lib/google/auth";
import { setAcceptingResponses, upsertForm } from "@/lib/google/forms";
import { parseFormId, parseSheetId, readResponseRows } from "@/lib/google/sheets";
import { runJob } from "@/lib/pipeline";
import type { FormQuestion, Job, QuestionType } from "@/lib/types";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

const DEFAULT_STAGES = [
  { name: "Shortlisted", prompt_calendar: false },
  { name: "Screening", prompt_calendar: true },
  { name: "Technical", prompt_calendar: true },
  { name: "Manager round", prompt_calendar: true },
  { name: "Offer", prompt_calendar: false },
];

const DEFAULT_QUESTIONS: { title: string; type: QuestionType; required: boolean; role?: "name" | "email" | "resume"; options?: string[] }[] = [
  { title: "Full name", type: "short", required: true, role: "name" },
  { title: "Email", type: "short", required: true, role: "email" },
  { title: "Current city", type: "short", required: true },
  { title: "Notice period", type: "dropdown", required: true, options: ["Immediate", "15 days", "30 days", "45 days", "60 days", "90 days or more"] },
  { title: "Tell us about the most relevant project you've worked on", type: "paragraph", required: true },
  { title: "Link to your resume (Drive, Dropbox or similar)", type: "short", required: true, role: "resume" },
];

/**
 * Creates a job. With `source_job_id`, copies the chosen parts of that job:
 * details (description + constraints), form questions, pipeline stages, and the
 * approved rubric — copied as a draft, so it still needs your review before scoring.
 */
export async function createJob(formData: FormData) {
  const { supabase } = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const sourceId = String(formData.get("source_job_id") ?? "") || null;
  const copy = (k: string) => Boolean(sourceId) && formData.get(`copy_${k}`) === "on";

  const source = sourceId
    ? (await supabase.from("jobs").select("*").eq("id", sourceId).maybeSingle<Job>()).data
    : null;

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      title,
      location: String(formData.get("location") ?? "").trim() || (source?.location ?? ""),
      based_on_job_id: source?.id ?? null,
      ...(source && copy("details")
        ? { description: source.description, constraints: source.constraints }
        : {}),
      ...(source ? { recheck_threshold: source.recheck_threshold, require_signoff: source.require_signoff } : {}),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // Pipeline stages
  const { data: srcStages } = source && copy("stages")
    ? await supabase.from("stages").select("name, prompt_calendar, position").eq("job_id", source.id).order("position")
    : { data: null };
  await supabase
    .from("stages")
    .insert((srcStages?.length ? srcStages : DEFAULT_STAGES).map((s, i) => ({ name: s.name, prompt_calendar: s.prompt_calendar, job_id: job.id, position: i })));

  // Form questions (never the Google form id — the new job gets its own form)
  const { data: srcQs } = source && copy("questions")
    ? await supabase.from("form_questions").select("title, type, required, options, role, position").eq("job_id", source.id).order("position")
    : { data: null };
  await supabase.from("form_questions").insert(
    (srcQs?.length ? srcQs : DEFAULT_QUESTIONS).map((q, i) => ({
      title: q.title, type: q.type, required: q.required, options: q.options ?? [], role: q.role ?? null,
      job_id: job.id, position: i,
    })),
  );

  // Rubric → draft v1 on the new job
  if (source?.current_rubric_id && copy("rubric")) {
    const { data: crit } = await supabase
      .from("rubric_criteria")
      .select("position, kind, name, description, weight, source_constraint, bias_flag, enabled")
      .eq("rubric_id", source.current_rubric_id);
    const { data: rubric } = await supabase
      .from("rubrics")
      .insert({ job_id: job.id, version: 1, status: "draft", source: "recruiter" })
      .select("id")
      .single();
    if (rubric && crit?.length) {
      await supabase.from("rubric_criteria").insert(crit.map((c) => ({ ...c, rubric_id: rubric.id })));
    }
  }

  revalidatePath("/jobs");
  redirect(`/jobs/${job.id}/setup${source ? "?from=" + source.id : ""}`);
}

export async function saveJobDetails(jobId: string, input: { title: string; location: string; description: string; constraints: string }): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!input.title.trim()) return { ok: false, error: "Give the job a title." };
  const { error } = await supabase.from("jobs").update(input).eq("id", jobId);
  if (error) return fail(error);
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: "Saved" };
}

export async function saveQuestions(
  jobId: string,
  questions: Pick<FormQuestion, "title" | "type" | "required" | "options" | "role">[],
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (questions.some((q) => !q.title.trim())) return { ok: false, error: "Every question needs text." };
  const { error: delErr } = await supabase.from("form_questions").delete().eq("job_id", jobId);
  if (delErr) return fail(delErr);
  const { error } = await supabase
    .from("form_questions")
    .insert(questions.map((q, i) => ({ ...q, title: q.title.trim(), job_id: jobId, position: i })));
  if (error) return fail(error);
  revalidatePath(`/jobs/${jobId}/setup`);
  return { ok: true, message: "Questions saved" };
}

/** Creates or updates the Google Form from the saved questions. */
export async function publishForm(jobId: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    const { data: qs } = await supabase.from("form_questions").select("*").eq("job_id", jobId).order("position");
    const { auth } = await googleFor(user.id);
    const res = await upsertForm(auth, {
      formId: job.form_source === "built" ? job.google_form_id : null,
      title: `${job.title} — Application`,
      description: job.location ? `${job.title} · ${job.location}` : job.title,
      questions: (qs ?? []) as FormQuestion[],
    });
    await supabase
      .from("jobs")
      .update({ form_source: "built", google_form_id: res.formId, google_form_url: res.responderUri })
      .eq("id", jobId);
    await Promise.all(
      ((qs ?? []) as FormQuestion[]).map((q, i) =>
        supabase.from("form_questions").update({ google_item_id: res.itemIds[i] }).eq("id", q.id),
      ),
    );
    await supabase.from("job_events").insert({
      job_id: jobId,
      kind: job.google_form_id && job.form_source === "built" ? "form_updated" : "form_published",
      detail: `${(qs ?? []).length} questions`,
    });
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true, message: job.google_form_id ? "Google Form updated" : "Google Form created and published" };
  } catch (e) {
    return fail(e);
  }
}

/** Links an existing Google Form + its response Sheet. */
export async function linkExistingForm(jobId: string, formUrl: string, sheetUrl: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const sheetId = parseSheetId(sheetUrl);
    if (!sheetId) return { ok: false, error: "That doesn't look like a Google Sheets link. Copy it from the browser address bar of the response sheet." };
    const formId = formUrl.trim() ? parseFormId(formUrl) : null;
    const { auth } = await googleFor(user.id);
    const rows = await readResponseRows(auth, sheetId); // verifies access
    await supabase
      .from("jobs")
      .update({ form_source: "linked", sheet_id: sheetId, google_form_id: formId, google_form_url: formUrl.trim() || null })
      .eq("id", jobId);
    await supabase.from("job_events").insert({ job_id: jobId, kind: "form_linked", detail: `${rows.length} responses at link time` });
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true, message: `Linked. ${rows.length} response${rows.length === 1 ? "" : "s"} found — they'll be pulled in now.` };
  } catch (e) {
    return fail(e);
  }
}

/** Pulls new responses and scores pending candidates now instead of waiting for the scheduler. */
export async function syncNow(jobId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
  if (!job) return { ok: false, error: "Job not found." };
  if (job.status === "closed") return { ok: false, error: "This job is closed. Reopen it to pull in new responses." };
  after(async () => {
    await runJob(createAdminClient(), job, 25);
  });
  return { ok: true, message: "Syncing responses and scoring in the background — refresh in a minute." };
}

export async function updateJobSettings(jobId: string, patch: { recheck_threshold?: number; require_signoff?: boolean }): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (patch.recheck_threshold != null && (patch.recheck_threshold < 0.5 || patch.recheck_threshold > 0.95))
    return { ok: false, error: "Threshold must be between 0.50 and 0.95." };
  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) return fail(error);
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true };
}

/**
 * Closes a job: stops syncing and scoring new responses and, where recruitflow
 * can reach the Google Form, stops it accepting responses. Everything stays viewable.
 */
export async function setJobOpen(jobId: string, open: boolean): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    const { error } = await supabase
      .from("jobs")
      .update({ status: open ? "open" : "closed", closed_at: open ? null : new Date().toISOString() })
      .eq("id", jobId);
    if (error) return fail(error);
    await supabase.from("job_events").insert({ job_id: jobId, kind: open ? "reopened" : "closed" });

    let formNote = "";
    if (job.google_form_id) {
      try {
        const { auth } = await googleFor(user.id);
        await setAcceptingResponses(auth, job.google_form_id, open);
        formNote = open ? " The Google Form accepts responses again." : " The Google Form no longer accepts responses.";
      } catch {
        formNote = open
          ? " Turn responses back on in Google Forms if you'd switched them off."
          : " recruitflow couldn't switch off the Google Form — turn off “Accepting responses” in Google Forms.";
      }
    }
    revalidatePath("/jobs");
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true, message: (open ? "Job reopened." : "Job closed. Its candidates and history stay available.") + formNote };
  } catch (e) {
    return fail(e);
  }
}

/** Permanently deletes a job and all its candidates, scores, rubrics and interviews. */
export async function deleteJob(jobId: string, confirmTitle: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: job } = await supabase.from("jobs").select("title").eq("id", jobId).single();
  if (!job) return { ok: false, error: "Job not found." };
  if (confirmTitle.trim() !== job.title.trim()) return { ok: false, error: "Type the job title exactly to confirm." };
  const { error } = await supabase.from("jobs").delete().eq("id", jobId);
  if (error) return fail(error);
  revalidatePath("/jobs");
  return { ok: true };
}
