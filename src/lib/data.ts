import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { relatedJobs, type Relation } from "./related";
import type { RuleQuestion } from "./rules";
import type {
  Candidate,
  Criterion,
  CriterionResult,
  DeepEvaluation,
  Evaluation,
  Interview,
  Job,
  Rubric,
  Stage,
} from "./types";

export type EvaluationWithResults = Evaluation & { criterion_results: CriterionResult[] };

export type CandidateRow = Candidate & {
  evaluation: EvaluationWithResults | null;
  /** true when the shown evaluation used an older rubric version */
  stale: boolean;
  rank: number | null;
  /** Latest stage-2 deep evaluation, if one was run */
  deep: DeepEvaluation | null;
  /** true when that deep evaluation used an older rubric version */
  deepStale: boolean;
  /** The recruiter moved them to stage 2 (CV review) */
  inStage2: boolean;
};

/** Shared by a job's layout and page within one request (same client instance from requireUser). */
export const getJob = cache(async (db: SupabaseClient, jobId: string) => {
  const { data } = await db.from("jobs").select("*").eq("id", jobId).maybeSingle();
  if (!data) notFound();
  return data as Job;
});

/** Latest rubric (draft if one is being edited) plus the approved one in use. */
export async function getRubrics(db: SupabaseClient, job: Job) {
  const { data } = await db
    .from("rubrics")
    .select("*, rubric_criteria(*)")
    .eq("job_id", job.id)
    .order("version", { ascending: false });
  const all = (data ?? []) as (Rubric & { rubric_criteria: Criterion[] })[];
  all.forEach((r) => r.rubric_criteria.sort((a, b) => a.position - b.position));
  const current = all.find((r) => r.id === job.current_rubric_id) ?? null;
  const draft = all.find((r) => r.status === "draft") ?? null;
  return { current, draft, all };
}

/**
 * Questions a form rule can check: the in-app form's questions (with types and options),
 * plus any question seen in received responses (covers linked forms/Sheets).
 */
export async function getRuleQuestions(db: SupabaseClient, jobId: string): Promise<RuleQuestion[]> {
  const [{ data: qs }, { data: cands }] = await Promise.all([
    db.from("form_questions").select("title, type, options, role").eq("job_id", jobId).order("position"),
    db.from("candidates").select("answers").eq("job_id", jobId).limit(50),
  ]);
  const out: RuleQuestion[] = (qs ?? []).map((q) => ({ title: q.title, type: q.type, options: q.options ?? [], role: q.role }));
  const seen = new Set(out.map((q) => q.title.trim().toLowerCase()));
  for (const c of cands ?? []) {
    for (const a of (c.answers ?? []) as { question: string }[]) {
      const k = a.question.trim().toLowerCase();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push({ title: a.question, type: "short", options: [] });
      }
    }
  }
  return out;
}

export async function getStages(db: SupabaseClient, jobId: string) {
  const { data } = await db.from("stages").select("*").eq("job_id", jobId).order("position");
  return (data ?? []) as Stage[];
}

export async function getInterviews(db: SupabaseClient, jobId: string) {
  const { data } = await db.from("interviews").select("*").eq("job_id", jobId).order("starts_at");
  return (data ?? []) as Interview[];
}

/** Candidates with their evaluation on the current rubric (or latest, flagged stale), ranked. */
export async function getCandidates(db: SupabaseClient, job: Job): Promise<CandidateRow[]> {
  const { data } = await db
    .from("candidates")
    .select("*, evaluations(*, criterion_results(*)), deep_evaluations(*)")
    .eq("job_id", job.id);
  const rows = ((data ?? []) as (Candidate & { evaluations: EvaluationWithResults[]; deep_evaluations: DeepEvaluation[] })[]).map((c) => {
    const evs = [...c.evaluations].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const current = evs.find((e) => e.rubric_id === job.current_rubric_id) ?? null;
    const evaluation = current ?? evs[0] ?? null;
    const deep = [...c.deep_evaluations].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
    const { evaluations: _omit, deep_evaluations: _omit2, ...rest } = c;
    void _omit; void _omit2;
    return {
      ...rest,
      evaluation,
      stale: !current && !!evaluation,
      rank: null as number | null,
      deep,
      deepStale: !!deep && deep.rubric_id !== job.current_rubric_id,
      inStage2: !!c.stage2_at,
    };
  });

  rows.sort((a, b) => {
    const ea = a.evaluation, eb = b.evaluation;
    if (!ea || !eb) return ea ? -1 : eb ? 1 : a.created_at.localeCompare(b.created_at);
    return (
      Number(ea.disqualified) - Number(eb.disqualified) ||
      eb.score - ea.score ||
      Number(eb.confidence) - Number(ea.confidence)
    );
  });
  let r = 0;
  rows.forEach((c) => {
    if (c.evaluation && !c.evaluation.disqualified) c.rank = ++r;
  });
  return rows;
}

export interface RelatedJobSummary {
  id: string;
  title: string;
  location: string;
  status: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  relation: Relation;
  applicants: number;
  qualified: number;
  avgScore: number | null;
  finalStage: string | null;
  reachedFinal: number;
  interviews: number;
}

/** Related jobs (lineage or similar title) with their hiring outcomes. */
export async function getRelatedJobs(db: SupabaseClient, job: Job): Promise<RelatedJobSummary[]> {
  const { data: all } = await db.from("jobs").select("id, title, location, status, created_at, closed_at, based_on_job_id, current_rubric_id");
  const matches = relatedJobs(job, (all ?? []) as (Pick<Job, "id" | "title" | "location" | "status" | "created_at" | "closed_at" | "based_on_job_id" | "current_rubric_id">)[]);
  if (!matches.length) return [];
  const ids = matches.map((m) => m.job.id);
  const [{ data: cands }, { data: stages }, { data: ivs }] = await Promise.all([
    db.from("candidates").select("job_id, stage_id, evaluations(rubric_id, score, disqualified)").in("job_id", ids),
    db.from("stages").select("id, job_id, name, position").in("job_id", ids),
    db.from("interviews").select("job_id").in("job_id", ids),
  ]);
  return matches.map(({ job: j, relation }) => {
    const cs = (cands ?? []).filter((c) => c.job_id === j.id);
    const evs = cs
      .map((c) => (c.evaluations as { rubric_id: string; score: number; disqualified: boolean }[]).find((e) => e.rubric_id === j.current_rubric_id))
      .filter((e): e is { rubric_id: string; score: number; disqualified: boolean } => !!e);
    const q = evs.filter((e) => !e.disqualified);
    const last = (stages ?? []).filter((s) => s.job_id === j.id).sort((a, b) => b.position - a.position)[0];
    return {
      id: j.id, title: j.title, location: j.location, status: j.status, created_at: j.created_at, closed_at: j.closed_at, relation,
      applicants: cs.length,
      qualified: q.length,
      avgScore: q.length ? Math.round(q.reduce((a, e) => a + e.score, 0) / q.length) : null,
      finalStage: last?.name ?? null,
      reachedFinal: last ? cs.filter((c) => c.stage_id === last.id).length : 0,
      interviews: (ivs ?? []).filter((i) => i.job_id === j.id).length,
    };
  });
}
