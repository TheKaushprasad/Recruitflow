import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { monthStart } from "./ai/usage";

export interface BudgetStatus {
  budget: number | null;
  spent: number;
  over: boolean;
}

/** This month's AI spend against the recruiter's budget (no budget = never over). */
export async function budgetFor(db: SupabaseClient, recruiterId: string): Promise<BudgetStatus> {
  const [{ data: settings }, { data: spent }] = await Promise.all([
    db.from("recruiter_settings").select("monthly_ai_budget_usd").eq("recruiter_id", recruiterId).maybeSingle(),
    db.rpc("ai_spend_since", { p_recruiter: recruiterId, p_since: monthStart() }),
  ]);
  const budget = settings?.monthly_ai_budget_usd == null ? null : Number(settings.monthly_ai_budget_usd);
  const s = Number(spent ?? 0);
  return { budget, spent: s, over: budget != null && s >= budget };
}

/** Recruiters who have hit their monthly budget; the worker skips their queue until next month. */
export async function recruitersOverBudget(db: SupabaseClient): Promise<string[]> {
  const { data: ids, error } = await db.rpc("recruiters_over_budget", { p_since: monthStart() });
  if (!error) return ((ids ?? []) as (string | { recruiters_over_budget: string })[]).map((r) => (typeof r === "string" ? r : r.recruiters_over_budget));
  // Before migration 0010: check one by one.
  const { data } = await db.from("recruiter_settings").select("recruiter_id").not("monthly_ai_budget_usd", "is", null);
  const over: string[] = [];
  for (const r of data ?? []) {
    if ((await budgetFor(db, r.recruiter_id)).over) over.push(r.recruiter_id);
  }
  return over;
}
