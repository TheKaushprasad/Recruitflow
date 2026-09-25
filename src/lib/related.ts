// Finds jobs related to a given job: same lineage (created from / used as a template)
// or similar titles. Pure so it can run on the server and in the new-job form.

export interface JobLite {
  id: string;
  title: string;
  based_on_job_id: string | null;
}

const STOP = new Set(["and", "the", "for", "with", "of", "to", "in", "a", "an", "role", "hiring", "job", "i", "ii", "iii"]);

export function titleTokens(title: string) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s-]/g, " ")
      .split(/[\s/-]+/)
      .map((w) => w.replace(/\.+$/, ""))
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}

/** Jaccard overlap of title words, 0..1 */
export function titleSimilarity(a: string, b: string) {
  const A = titleTokens(a);
  const B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / (A.size + B.size - inter);
}

export type Relation = "template" | "created from this" | "same template" | "similar title";

export function relatedJobs<T extends JobLite>(target: { id?: string; title: string; based_on_job_id?: string | null }, jobs: T[], limit = 6) {
  const out: { job: T; relation: Relation; score: number }[] = [];
  for (const j of jobs) {
    if (j.id === target.id) continue;
    let relation: Relation | null = null;
    let score = titleSimilarity(target.title, j.title);
    if (target.based_on_job_id && j.id === target.based_on_job_id) { relation = "template"; score += 2; }
    else if (target.id && j.based_on_job_id === target.id) { relation = "created from this"; score += 1.5; }
    else if (target.based_on_job_id && j.based_on_job_id === target.based_on_job_id) { relation = "same template"; score += 1; }
    else if (score >= 0.34) relation = "similar title";
    if (relation) out.push({ job: j, relation, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
