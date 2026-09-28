"use server";

import { errorMessage } from "@/lib/errors";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { googleFor } from "@/lib/google/auth";
import { busyTimes, createInterviewEvent, deleteEvent } from "@/lib/google/calendar";
import { createSpreadsheet, writeResultsTab } from "@/lib/google/sheets";
import { getCandidates, getRubrics } from "@/lib/data";
import type { Job, Stage } from "@/lib/types";
import type { ActionResult } from "./jobs";

function fail(e: unknown): ActionResult {
  return { ok: false, error: errorMessage(e) };
}

export async function moveCandidates(jobId: string, candidateIds: string[], stageId: string | null): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const [{ data: before }, { data: stages }] = await Promise.all([
    supabase.from("candidates").select("id, stage_id").in("id", candidateIds).eq("job_id", jobId),
    supabase.from("stages").select("id, name").eq("job_id", jobId),
  ]);
  const name = (id: string | null) => (id ? stages?.find((s) => s.id === id)?.name ?? null : null);
  const { error } = await supabase.from("candidates").update({ stage_id: stageId }).in("id", candidateIds).eq("job_id", jobId);
  if (error) return fail(error);
  const moves = (before ?? [])
    .filter((c) => c.stage_id !== stageId)
    .map((c) => ({ job_id: jobId, candidate_id: c.id, from_stage: name(c.stage_id), to_stage: name(stageId) }));
  if (moves.length) await supabase.from("stage_moves").insert(moves);
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true };
}

export async function saveStages(jobId: string, stages: Pick<Stage, "id" | "name" | "prompt_calendar">[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  if (!stages.length) return { ok: false, error: "Keep at least one stage." };
  if (stages.some((s) => !s.name.trim())) return { ok: false, error: "Every stage needs a name." };
  const { data: existing } = await supabase.from("stages").select("id").eq("job_id", jobId);
  const keep = new Set(stages.filter((s) => !s.id.startsWith("new-")).map((s) => s.id));
  const removed = (existing ?? []).map((s) => s.id).filter((id) => !keep.has(id));

  const ids: string[] = [];
  for (const [i, s] of stages.entries()) {
    const row = { name: s.name.trim(), prompt_calendar: s.prompt_calendar, position: i, job_id: jobId };
    if (s.id.startsWith("new-")) {
      const { data, error } = await supabase.from("stages").insert(row).select("id").single();
      if (error) return fail(error);
      ids.push(data.id);
    } else {
      const { error } = await supabase.from("stages").update(row).eq("id", s.id);
      if (error) return fail(error);
      ids.push(s.id);
    }
  }
  if (removed.length) {
    // Candidates in a deleted stage move to the first remaining stage rather than falling out.
    await supabase.from("candidates").update({ stage_id: ids[0] }).in("stage_id", removed);
    await supabase.from("stages").delete().in("id", removed);
  }
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: "Stages saved" };
}

export async function getBusy(dateIso: string): Promise<{ ok: true; busy: { start: string; end: string }[] } | { ok: false; error: string }> {
  try {
    const { user } = await requireUser();
    const { auth } = await googleFor(user.id);
    const day = new Date(dateIso);
    const end = new Date(day.getTime() + 24 * 3600_000);
    return { ok: true, busy: await busyTimes(auth, day, end) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function scheduleInterview(input: {
  jobId: string;
  candidateId: string;
  startIso: string;
  durationMin: number;
  interviewers: string[];
  note: string;
}): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const { data: c } = await supabase.from("candidates").select("*").eq("id", input.candidateId).single();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", input.jobId).single<Job>();
    if (!c || !job) return { ok: false, error: "Candidate not found." };
    if (!c.email) return { ok: false, error: `${c.name} has no email address on their application, so they can't be invited.` };
    const start = new Date(input.startIso);
    if (isNaN(start.getTime()) || start.getTime() < Date.now()) return { ok: false, error: "Pick a start time in the future." };
    const stage = c.stage_id ? (await supabase.from("stages").select("name").eq("id", c.stage_id).single()).data : null;

    const { auth } = await googleFor(user.id);
    // Replace an existing invite for this candidate + stage.
    const { data: prior } = await supabase.from("interviews").select("*").eq("candidate_id", c.id).eq("stage_id", c.stage_id);
    for (const p of prior ?? []) {
      if (p.google_event_id) await deleteEvent(auth, p.google_event_id).catch(() => undefined);
      await supabase.from("interviews").delete().eq("id", p.id);
    }

    const attendees = [c.email, ...input.interviewers.filter((e) => /\S+@\S+\.\S+/.test(e))];
    const ev = await createInterviewEvent(auth, {
      summary: `${job.title}: ${stage?.name ?? "Interview"} — ${c.name}`,
      description: input.note,
      start,
      durationMin: input.durationMin,
      attendees,
    });
    const { error } = await supabase.from("interviews").insert({
      job_id: job.id, candidate_id: c.id, stage_id: c.stage_id, starts_at: start.toISOString(),
      duration_min: input.durationMin, attendees, google_event_id: ev.id, meet_url: ev.meetUrl, html_link: ev.htmlLink,
    });
    if (error) return fail(error);
    revalidatePath(`/jobs/${job.id}`, "layout");
    return { ok: true, message: `Invite sent to ${c.name}${ev.meetUrl ? " with a Meet link" : ""}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelInterview(interviewId: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const { data: iv } = await supabase.from("interviews").select("*").eq("id", interviewId).single();
    if (!iv) return { ok: false, error: "Interview not found." };
    if (iv.google_event_id) {
      const { auth } = await googleFor(user.id);
      await deleteEvent(auth, iv.google_event_id).catch(() => undefined);
    }
    await supabase.from("interviews").delete().eq("id", interviewId);
    revalidatePath(`/jobs/${iv.job_id}`, "layout");
    return { ok: true, message: "Interview cancelled; attendees notified." };
  } catch (e) {
    return fail(e);
  }
}

/** Writes the ranked table to a "Ranked — vN" tab (linked Sheet, or a new spreadsheet for in-app forms). */
export async function exportResults(jobId: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    const { current } = await getRubrics(supabase, job);
    if (!current) return { ok: false, error: "Approve a rubric before exporting." };
    const cands = await getCandidates(supabase, job);
    const soft = current.rubric_criteria.filter((c) => c.kind === "soft" && c.enabled);
    const hard = current.rubric_criteria.filter((c) => c.kind === "hard" && c.enabled);
    const rules = current.rubric_criteria.filter((c) => c.kind === "rule" && c.enabled);
    const header = ["Rank", "Name", "Email", "Stage 1 score", "Confidence", "Disqualified", "Needs review", "Reason",
      ...rules.map((r) => `[Form rule] ${r.name}`), ...hard.map((h) => `[Filter] ${h.name}`), ...soft.map((s) => s.name),
      "Stage 2 score", "Stage 2 verdict", "Stage 2 summary"];
    const rows = cands
      .filter((c) => c.evaluation && !c.stale)
      .map((c) => {
        const e = c.evaluation!;
        const res = (id: string) => {
          const r = e.criterion_results.find((x) => x.criterion_id === id);
          return r ? `${r.decision} (${Number(r.confidence).toFixed(2)}) — ${r.evidence}` : "";
        };
        const d = c.deep?.status === "done" && !c.deepStale ? c.deep : null;
        return [c.rank ?? "", c.name, c.email ?? "", e.score, Number(e.confidence).toFixed(2),
          e.disqualified ? "yes" : "", e.needs_review ? "yes" : "", e.reason,
          ...rules.map((r) => res(r.id)), ...hard.map((h) => res(h.id)), ...soft.map((s) => res(s.id)),
          d?.score ?? "", d ? (d.disqualified ? "hard filter" : d.verdict ?? "") : "", d?.summary ?? ""];
      });

    const { auth } = await googleFor(user.id);
    let sheetId = job.sheet_id;
    if (!sheetId) {
      sheetId = await createSpreadsheet(auth, `${job.title} — reqroot results`);
      await supabase.from("jobs").update({ sheet_id: sheetId }).eq("id", jobId);
    }
    await writeResultsTab(auth, sheetId, `Ranked — v${current.version}`, [header, ...rows]);
    return { ok: true, message: `Exported ${rows.length} candidates to the “Ranked — v${current.version}” tab.` };
  } catch (e) {
    return fail(e);
  }
}
