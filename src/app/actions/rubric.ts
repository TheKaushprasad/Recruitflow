"use server";

import { errorMessage } from "@/lib/errors";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftExpectedAnswer, draftStage1, draftStage2 } from "@/lib/ai/llm";
import { scorePending } from "@/lib/pipeline";
import { getRuleQuestions } from "@/lib/data";
import { describeRule, validateRule, type FormRule } from "@/lib/rules";
import type { Criterion, CriterionKind, Job } from "@/lib/types";
import type { ActionResult } from "./jobs";

type Db = Awaited<ReturnType<typeof requireUser>>["supabase"];

function fail(e: unknown): ActionResult {
  return { ok: false, error: errorMessage(e) };
}

async function nextVersion(db: Db, jobId: string) {
  const { data } = await db.from("rubrics").select("version").eq("job_id", jobId).order("version", { ascending: false }).limit(1);
  return (data?.[0]?.version ?? 0) + 1;
}

async function approve(db: Db, job: Job, rubricId: string) {
  if (job.current_rubric_id) {
    await db.from("rubrics").update({ status: "superseded" }).eq("id", job.current_rubric_id);
  }
  await db.from("rubrics").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", rubricId);
  await db.from("jobs").update({ current_rubric_id: rubricId }).eq("id", job.id);
  // Everyone gets a stage-1 result on the new version. Unchanged AI items are reused, so this is
  // instant and free when only filters, weights or the stage-2 rubric changed.
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

/** The draft to edit: the existing draft, or a new version copied from the approved rubric (or empty). */
async function ensureDraft(db: Db, job: Job, source: "openai" | "recruiter", model: string | null) {
  const { data: existing } = await db.from("rubrics").select("id").eq("job_id", job.id).eq("status", "draft").maybeSingle();
  if (existing) {
    if (source === "openai") await db.from("rubrics").update({ source, model }).eq("id", existing.id);
    return existing.id as string;
  }
  const { data: rubric, error } = await db
    .from("rubrics")
    .insert({ job_id: job.id, version: await nextVersion(db, job.id), status: "draft", source, model })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (job.current_rubric_id) {
    const { data: crit } = await db.from("rubric_criteria").select("*").eq("rubric_id", job.current_rubric_id);
    if (crit?.length) {
      await db.from("rubric_criteria").insert(
        (crit as Criterion[]).map(({ id: _id, recruiter_id: _r, rubric_id: _rid, ...c }) => {
          void _id; void _r; void _rid;
          return { ...c, rubric_id: rubric.id };
        }),
      );
    }
  }
  return rubric.id as string;
}

/**
 * OpenAI drafts one stage of the rubric and replaces that stage in the draft; the other stage is kept.
 * Stage 1: filters on form answers (exact or AI-checked) + criteria for free-text answers.
 * Stage 2: criteria and must-haves for the CV / portfolio / GitHub review.
 */
export async function generateStage(jobId: string, stage: 1 | 2): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    if (job.description.trim().length < 80) return { ok: false, error: "Add a fuller job description in Job setup first — OpenAI needs the responsibilities and requirements." };

    let rows: Record<string, unknown>[];
    let model: string;
    let dropped = 0;
    if (stage === 1) {
      const questions = await getRuleQuestions(supabase, jobId);
      if (!questions.length) return { ok: false, error: "Add form questions in Job setup first — stage 1 screens their answers." };
      const res = await draftStage1({ ...job, questions });
      model = res.model;
      const filters: Record<string, unknown>[] = [];
      for (const f of res.draft.filters) {
        const rule: FormRule = {
          question: questions.find((q) => q.title.trim().toLowerCase() === f.question.trim().toLowerCase())?.title ?? f.question,
          op: f.op, value: f.value, value2: f.value2, options: f.options, date: f.date, instruction: f.instruction, action: f.action,
        };
        if (validateRule(rule, questions)) { dropped++; continue; }
        filters.push({
          stage: 1, kind: "rule", name: f.name, description: describeRule(rule), rule,
          // points when passed; open-ended answers weigh more than single-field checks
          weight: f.op === "ai_expected" ? 30 : 10, source_constraint: f.source_constraint,
        });
      }
      rows = filters;
    } else {
      const res = await draftStage2(job);
      model = res.model;
      rows = [
        ...res.draft.must_haves.map((h) => ({ stage: 2, kind: "hard", name: h.name, description: h.description, weight: 0, source_constraint: h.source_constraint })),
        ...res.draft.criteria.map((c) => ({ stage: 2, kind: "soft", name: c.name, description: c.description, weight: c.weight, bias_flag: c.bias_flag })),
      ];
    }

    const rubricId = await ensureDraft(supabase, job, "openai", model);
    await supabase.from("rubric_criteria").delete().eq("rubric_id", rubricId).eq("stage", stage);
    const { error } = await supabase
      .from("rubric_criteria")
      .insert(rows.map((r, i) => ({ ...r, rubric_id: rubricId, position: i })));
    if (error) return fail(error);
    await supabase.from("rubrics").update({ bias_reviewed: false }).eq("id", rubricId);

    revalidatePath(`/jobs/${jobId}`, "layout");
    return {
      ok: true,
      message: `Stage ${stage} drafted with OpenAI — review it, then approve.${dropped ? ` ${dropped} suggested filter${dropped === 1 ? " was" : "s were"} skipped (didn't match a form question or failed the fairness check).` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** OpenAI writes a sample strong answer to an open-ended form question, from the job description. */
export async function generateExpectedAnswer(jobId: string, question: string): Promise<ActionResult & { answer?: string }> {
  try {
    const { supabase } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("title, description").eq("id", jobId).single();
    if (!job) return { ok: false, error: "Job not found." };
    if (job.description.trim().length < 80) return { ok: false, error: "Add a fuller job description in Job setup first — the expected answer is based on it." };
    if (!question.trim()) return { ok: false, error: "Pick the question first." };
    const answer = await draftExpectedAnswer({ title: job.title, description: job.description, question });
    return { ok: true, message: "Expected answer drafted — edit it as you like.", answer };
  } catch (e) {
    return fail(e);
  }
}

/** Starts editing: a new draft version copied from the approved rubric (or an empty one). */
export async function editRubric(jobId: string): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    const { data: job } = await supabase.from("jobs").select("*").eq("id", jobId).single<Job>();
    if (!job) return { ok: false, error: "Job not found." };
    await ensureDraft(supabase, job, "recruiter", null);
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function discardDraft(jobId: string): Promise<ActionResult> {
  const { supabase } = await requireUser();
  await supabase.from("rubrics").delete().eq("job_id", jobId).eq("status", "draft");
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: "Draft discarded" };
}

type CriterionPatch = Partial<Pick<Criterion, "name" | "description" | "weight" | "enabled" | "rule" | "kind">>;
export interface NewCriterion {
  stage: 1 | 2;
  kind: CriterionKind;
  name: string;
  description: string;
  weight: number;
  rule?: FormRule | null;
}

/** Saves all edits to a draft in one go: changed items, new items and deletions, for both stages. */
export async function saveDraft(rubricId: string, patches: { id: string; patch: CriterionPatch }[], added: NewCriterion[], removed: string[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data: rubric } = await supabase.from("rubrics").select("status, job_id").eq("id", rubricId).single();
  if (rubric?.status !== "draft") return { ok: false, error: "Only draft rubrics can be edited. Click “Edit” to start a new version." };

  for (const x of [...patches.map((p) => p.patch), ...added]) {
    if ("name" in x && x.name !== undefined && !x.name.trim()) return { ok: false, error: "Every filter and criterion needs a name." };
  }
  // Filters are validated here too — the editor's checks are a convenience, not a guarantee.
  const questions = await getRuleQuestions(supabase, rubric.job_id);
  for (const r of [...patches.map((p) => p.patch.rule), ...added.map((a) => a.rule)]) {
    if (!r) continue;
    const problem = validateRule(r, questions);
    if (problem) return { ok: false, error: problem };
  }
  if (added.some((a) => a.kind === "rule" && !a.rule)) return { ok: false, error: "A filter is missing its settings." };
  if (added.some((a) => a.kind === "rule" && a.stage !== 1)) return { ok: false, error: "Filters on form answers belong to stage 1." };
  for (const p of patches) if (p.patch.rule) p.patch.description = describeRule(p.patch.rule);
  for (const a of added) if (a.kind === "rule" && a.rule) a.description = describeRule(a.rule);

  // Only known fields are taken from the browser — never ids, owners or rubric links.
  const pick = (p: CriterionPatch) => {
    const out: CriterionPatch = {};
    if (p.name !== undefined) out.name = String(p.name).trim();
    if (p.description !== undefined) out.description = String(p.description);
    if (p.weight !== undefined) out.weight = Math.max(0, Math.min(100, Math.round(Number(p.weight) || 0)));
    if (p.enabled !== undefined) out.enabled = Boolean(p.enabled);
    if (p.rule !== undefined) out.rule = p.rule;
    return out;
  };
  const { user } = await requireUser();
  for (const { id, patch } of patches) {
    const { error } = await supabase.from("rubric_criteria").update(pick(patch)).eq("id", id).eq("rubric_id", rubricId);
    if (error) return fail(error);
  }
  if (removed.length) await supabase.from("rubric_criteria").delete().in("id", removed).eq("rubric_id", rubricId);
  if (added.length) {
    const { error } = await supabase.from("rubric_criteria").insert(
      added.map((a, i) => ({
        ...pick(a),
        stage: a.stage === 2 ? 2 : 1,
        kind: (["hard", "soft", "rule"] as const).includes(a.kind) ? a.kind : "soft",
        rule: a.kind === "rule" ? a.rule : null,
        rubric_id: rubricId,
        recruiter_id: user.id,
        position: 500 + i,
      })),
    );
    if (error) return fail(error);
  }
  await supabase.from("rubrics").update({ bias_reviewed: false, source: "recruiter" }).eq("id", rubricId);
  revalidatePath(`/jobs/${rubric.job_id}/rubric`);
  return { ok: true, message: "Draft saved" };
}

export async function approveRubric(rubricId: string, biasReviewed: boolean): Promise<ActionResult> {
  try {
    const { supabase } = await requireUser();
    if (!biasReviewed) return { ok: false, error: "Confirm the bias review before approving." };
    const { data: rubric } = await supabase.from("rubrics").select("*, rubric_criteria(kind, weight, enabled, rule, name, stage)").eq("id", rubricId).single();
    if (!rubric || rubric.status !== "draft") return { ok: false, error: "This rubric isn't a draft." };
    const crit = (rubric.rubric_criteria as Criterion[]).filter((c) => c.enabled);
    if (!crit.some((c) => c.stage === 1)) return { ok: false, error: "Stage 1 needs at least one filter or criterion — it's how every applicant is screened." };
    const questions = await getRuleQuestions(supabase, rubric.job_id);
    for (const c of crit.filter((c) => c.kind === "rule" && c.rule)) {
      const problem = validateRule(c.rule!, questions);
      if (problem) return { ok: false, error: `Filter “${c.name}”: ${problem}` };
    }
    const { data: job } = await supabase.from("jobs").select("*").eq("id", rubric.job_id).single<Job>();
    await supabase.from("rubrics").update({ bias_reviewed: true }).eq("id", rubricId);
    await approve(supabase, job!, rubricId);
    revalidatePath(`/jobs/${rubric.job_id}`, "layout");
    return { ok: true, message: `Rubric v${rubric.version} approved. Stage-1 results update in the background.` };
  } catch (e) {
    return fail(e);
  }
}

export async function retryScoring(candidateIds: string[]): Promise<ActionResult> {
  const { supabase } = await requireUser();
  const { data } = await supabase.from("candidates").update({ score_status: "pending", score_error: null }).in("id", candidateIds).select("job_id");
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
