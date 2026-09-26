import { requireUser } from "@/lib/supabase/server";
import { activeProvider, PROVIDER_LABEL } from "@/lib/ai/provider";
import { getJob, getRubrics } from "@/lib/data";
import { ACTION_LABEL, describeRule } from "@/lib/rules";
import { SetupForm } from "./SetupForm";
import { DeleteJob } from "@/components/DeleteJob";
import type { FormQuestion } from "@/lib/types";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

export default async function SetupPage({ params }: PageProps<"/jobs/[id]/setup">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const { data: qs } = await supabase.from("form_questions").select("*").eq("job_id", id).order("position");
  const { data: conn } = await supabase.from("google_connection_status").select("google_email").maybeSingle();
  const { count } = await supabase.from("candidates").select("id", { count: "exact", head: true }).eq("job_id", id);
  // Screening rules on each question (from the draft being edited, else the approved rubric)
  const { current, draft } = await getRubrics(supabase, job);
  const ruleNotes: Record<string, string[]> = {};
  for (const c of (draft ?? current)?.rubric_criteria ?? []) {
    if (c.kind !== "rule" || !c.rule || !c.enabled) continue;
    const k = c.rule.question.trim().toLowerCase();
    (ruleNotes[k] ??= []).push(`${describeRule(c.rule)} → ${ACTION_LABEL[c.rule.action].toLowerCase()}`);
  }
  return (
    <>
      <SetupForm job={job} questions={(qs ?? []) as FormQuestion[]} googleConnected={!!conn} responses={count ?? 0} aiName={PROVIDER_LABEL[activeProvider() ?? "claude"]} ruleNotes={ruleNotes} />
      <DeleteJob jobId={job.id} title={job.title} candidates={count ?? 0} />
    </>
  );
}
