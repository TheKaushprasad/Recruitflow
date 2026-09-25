import { requireUser } from "@/lib/supabase/server";
import { getCandidates, getInterviews, getJob, getRubrics, getStages } from "@/lib/data";
import { Board } from "./Board";
import type { EmailTemplate } from "@/lib/types";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

export default async function PipelinePage({ params }: PageProps<"/jobs/[id]/pipeline">) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const [cands, stages, interviews, rubrics, templates] = await Promise.all([
    getCandidates(supabase, job),
    getStages(supabase, id),
    getInterviews(supabase, id),
    getRubrics(supabase, job),
    supabase.from("email_templates").select("*").order("created_at").then((r) => (r.data ?? []) as EmailTemplate[]),
  ]);
  const criteria = rubrics.all.flatMap((r) => r.rubric_criteria.map((c) => ({ ...c, version: r.version })));
  return <Board job={job} candidates={cands} stages={stages} interviews={interviews} criteria={criteria} templates={templates} />;
}
