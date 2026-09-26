"use server";

import { errorMessage } from "@/lib/errors";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractRubric } from "@/lib/ai/llm";
import { activeProvider, PROVIDER_LABEL } from "@/lib/ai/provider";
import { scorePending } from "@/lib/pipeline";
import { getRuleQuestions } from "@/lib/data";
import { describeRule, validateRule, type FormRule } from "@/lib/rules";
import type { Criterion, Job, Rubric } from "@/lib/types";
import type { ActionResult } from "./jobs";

function fail(e: unknown): ActionResult {
  return { ok: false, error: errorMessage(e) };
}

async function nextVersion(db: Awaited<ReturnType<typeof requireUser>>["supabase"], jobId: string) {
  const { data } = await db.from("rubrics").select("version").eq("job_id", jobId).order("version", { ascending: false }).limit(1);
  return (data?.[0]?.version ?? 0) + 1;
}

async function approve(db: Awaited<ReturnType<typeof requireUser>>["supabase"], job: Job, rubricId: string) {
  if (job.current_rubric_id) {
    await db.from("rubrics").update({ status: "superseded" }).eq("id", job.current_rubric_id);
  }
  await db.from("rubrics").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", rubricId);
  await db.from("jobs").update({ current_rubric_id: rubricId }).eq("id", job.id);
  // Every candidate lacks an evaluation on the new version, so this re-scores all of them.
  after(async () => {
    const admin = createAdminClient();
    const { data: fresh } = await admin.from("jobs").select("*").eq("id", job.id).single<Job>();
    if (fresh) {
      for (let i = 0; i < 20; i++) {
        const r = await scorePending(admin, fresh, 10);
        if (!r.remaining || (!r.scored && !r.failed)) break;
      }
    }
  });
}

/** The AI (Claude or OpenAI) drafts a rubric from the JD + constraints. Replaces any unapproved draft. */
export async function generateRubric(jobId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    if (job.description.trim().length < 80)
      return { ok: false, error: `Add a fuller job description first — ${PROVIDER_LABEL[activeProvider() ?? "claude"]} needs the responsibilities and requirements.` };

    const questions = await getRuleQuestions(supabase, jobId);
    const { draft, model, provider } = await extractRubric({ ...job, questions });
    await supabase.from("rubrics").delete().eq("job_id", jobId).eq("status", "draft");
    const { data: rubric, error } = await supabase
      .from("rubrics")
      .insert({ job_id: jobId, version: await nextVersion(supabase, jobId), status: "draft", source: provider, model })
      .select("*")
      .single<Rubric>();
    if (error) return fail(error);

    // Suggested form rules are kept only if they check a real question correctly and fairly;
    // anything else falls back to an AI-judged hard filter so the constraint isn't lost.
    const ruleRows: Record<string, unknown>[] = [];
    const fallbackFilters: typeof draft.hard_filters = [];
    for (const s of draft.form_rules) {
      const rule: FormRule = {
        question: questions.find((q) => q.title.trim().toLowerCase() === s.question.trim().toLowerCase())?.title ?? s.question,
        op: s.op, value: s.value, value2: s.value2, options: s.options, date: s.date, action: s.action,
      };
      if (validateRule(rule, questions)) {
        fallbackFilters.push({ name: s.name, description: `Check from the application: ${s.source_constraint}`, source_constraint: s.source_constraint });
      } else {
        ruleRows.push({
          rubric_id: rubric.id, position: ruleRows.length, kind: "rule", name: s.name, description: describeRule(rule),
          weight: rule.action === "score" ? 10 : 0, source_constraint: s.source_constraint, rule,
        });
      }
    }

    const rows = [
      ...ruleRows,
      ...[...draft.hard_filters, ...fallbackFilters].map((h, i) => ({
        rubric_id: rubric.id, position: 50 + i, kind: "hard", name: h.name, description: h.description,
        weight: 0, source_constraint: h.source_constraint,
      })),
      ...draft.criteria.map((c, i) => ({
        rubric_id: rubric.id, position: 100 + i, kind: "soft", name: c.name, description: c.description,
        weight: c.weight, bias_flag: c.bias_flag,
      })),
    ];
    const { error: cErr } = await supabase.from("rubric_criteria").insert(rows);
    if (cErr) return fail(cErr);

    if (!job.require_signoff) await approve(supabase, job, rubric.id);
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true, message: job.require_signoff ? "Draft rubric ready — review it before scoring starts." : "Rubric generated and applied." };
  } catch (e) {
    return fail(e);
  }
}

/** Starts editing: copies the approved rubric into a new draft version. */
export async function editRubric(jobId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
  if (!job?.current_rubric_id) return { ok: false, error: "There's no approved rubric to edit yet." };
  const { data: existing } = await supabase.from("rubrics").select("id").eq("job_id", jobId).eq("status", "draft").maybeSingle();
  if (existing) return { ok: true };
  const { data: crit } = await supabase.from("rubric_criteria").select("*").eq("rubric_id", job.current_rubric_id);
  const { data: rubric, error } = await supabase
    .from("rubrics")
    .insert({ job_id: jobId, version: await nextVersion(supabase, jobId), status: "draft", source: "recruiter" })
    .select("id")
    .single();
  if (error) return fail(error);
  await supabase.from("rubric_criteria").insert(
    ((crit ?? []) as Criterion[]).map(({ id: _id, recruiter_id: _r, rubric_id: _rid, ...c }) => {
      void _id; void _r; void _rid;
      return { ...c, rubric_id: rubric.id };
    }),
  );
  revalidatePath(`/jobs/${jobId}/rubric`);
  return { ok: true };
}

export async function discardDraft(jobId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  await supabase.from("rubrics").delete().eq("job_id", jobId).eq("status", "draft");
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: "Draft discarded" };
}

type CriterionPatch = Partial<Pick<Criterion, "name" | "description" | "weight" | "enabled" | "rule">>;

/** Saves all criterion and form-rule edits on a draft rubric in one go. */
export async function saveDraft(
  rubricId: string,
  patches: { id: string; patch: CriterionPatch }[],
  added: { kind: "soft" | "rule"; name: string; description: string; weight: number; rule?: FormRule | null }[],
  removed: string[],
): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: rubric } = await supabase.from("rubrics").select("status, job_id").eq("id", rubricId).single();
  if (rubric?.status !== "draft") return { ok: false, error: "Only draft rubrics can be edited. Click “Edit rubric” to start a new version." };

  // Form rules are validated here too — the editor's checks are a convenience, not a guarantee.
  const questions = await getRuleQuestions(supabase, rubric.job_id);
  for (const r of [...patches.map((p) => p.patch.rule), ...added.map((a) => a.rule)]) {
    if (!r) continue;
    const problem = validateRule(r, questions);
    if (problem) return { ok: false, error: problem };
  }
  for (const p of patches) if (p.patch.rule) p.patch.description = describeRule(p.patch.rule);
  for (const a of added) if (a.kind === "rule" && a.rule) a.description = describeRule(a.rule);
  if (added.some((a) => a.kind === "rule" && !a.rule)) return { ok: false, error: "A form rule is missing its settings." };

  for (const { id, patch } of patches) {
    const { error } = await supabase.from("rubric_criteria").update(patch).eq("id", id).eq("rubric_id", rubricId);
    if (error) return fail(error);
  }
  if (removed.length) await supabase.from("rubric_criteria").delete().in("id", removed).eq("rubric_id", rubricId);
  if (added.length) {
    const { error } = await supabase
      .from("rubric_criteria")
      .insert(added.map((a, i) => ({ ...a, rubric_id: rubricId, position: 500 + i })));
    if (error) return fail(error);
  }
  await supabase.from("rubrics").update({ bias_reviewed: false }).eq("id", rubricId);
  revalidatePath(`/jobs/${rubric.job_id}/rubric`);
  return { ok: true, message: "Draft saved" };
}

export async function approveRubric(rubricId: string, biasReviewed: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    if (!biasReviewed) return { ok: false, error: "Confirm the bias review before approving." };
    const { data: rubric } = await supabase.from("rubrics").select("*, rubric_criteria(kind, weight, enabled, rule, name)").eq("id", rubricId).single();
    if (!rubric || rubric.status !== "draft") return { ok: false, error: "This rubric isn't a draft." };
    const crit = (rubric.rubric_criteria as Criterion[]).filter((c) => c.enabled);
    const scored = crit.filter((c) => c.kind === "soft" || (c.kind === "rule" && c.rule?.action === "score"));
    if (!scored.length || scored.every((c) => c.weight === 0)) return { ok: false, error: "Give at least one scored criterion a weight above zero." };
    const questions = await getRuleQuestions(supabase, rubric.job_id);
    for (const c of crit.filter((c) => c.kind === "rule" && c.rule)) {
      const problem = validateRule(c.rule!, questions);
      if (problem) return { ok: false, error: `Form rule “${c.name}”: ${problem}` };
    }
    const { data: job } = await supabase.from("jobs").select("*").eq("id", rubric.job_id).single<Job>();
    await supabase.from("rubrics").update({ bias_reviewed: true }).eq("id", rubricId);
    await approve(supabase, job!, rubricId);
    revalidatePath(`/jobs/${rubric.job_id}`, "layout");
    return { ok: true, message: `Rubric v${rubric.version} approved. Re-scoring every candidate in the background.` };
  } catch (e) {
    return fail(e);
  }
}

export async function retryScoring(candidateIds: string[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("candidates")
    .update({ score_status: "pending", score_error: null })
    .in("id", candidateIds)
    .select("job_id");
  const jobId = data?.[0]?.job_id;
  if (jobId) {
    after(async () => {
      const admin = createAdminClient();
      const { data: job } = await admin.from("jobs").select("*").eq("id", jobId).single<Job>();
      if (job) await scorePending(admin, job, candidateIds.length);
    });
    revalidatePath(`/jobs/${jobId}`, "layout");
  }
  return { ok: true, message: "Re-scoring started" };
}
