import { requireUser } from "@/lib/supabase/server";
import { getCandidates, getJob, getRubrics, getStages } from "@/lib/data";
import { CandidatesTable } from "./CandidatesTable";
import type { EmailTemplate } from "@/lib/types";

// Server actions on this page may score candidates in the background (after()).
export const maxDuration = 300;

export default async function CandidatesPage({ params, searchParams }: PageProps<"/jobs/[id]/candidates">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const job = await getJob(supabase, id);
  const [cands, rubrics, stages, templates] = await Promise.all([
    getCandidates(supabase, job),
    getRubrics(supabase, job),
    getStages(supabase, id),
    supabase.from("email_templates").select("*").order("created_at").then((r) => (r.data ?? []) as EmailTemplate[]),
  ]);
  // All criteria across versions, so a stale evaluation still resolves names.
  const criteria = rubrics.all.flatMap((r) => r.rubric_criteria.map((c) => ({ ...c, version: r.version })));
  return (
    <CandidatesTable
      job={job}
      candidates={cands}
      criteria={criteria}
      currentVersion={rubrics.current?.version ?? null}
      stages={stages}
      templates={templates}
      initialFilter={typeof sp.f === "string" ? sp.f : "all"}
      openId={typeof sp.c === "string" ? sp.c : null}
    />
  );
}
