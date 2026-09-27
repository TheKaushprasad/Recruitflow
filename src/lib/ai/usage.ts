import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAdminClient } from "../supabase/admin";
import { costUsd } from "./pricing";

export type UsagePurpose = "stage1" | "stage1_explain" | "stage2" | "rubric";

interface UsageContext {
  recruiterId: string;
  jobId: string | null;
  purpose: UsagePurpose;
}

// Who an AI call is billed to. Set once around a unit of work (scoring a candidate, a CV review,
// a rubric draft), so the low-level OpenAI/Jev clients can log usage without threading ids through.
const store = new AsyncLocalStorage<UsageContext>();

export function withUsage<T>(ctx: UsageContext, fn: () => Promise<T>): Promise<T> {
  return store.run(ctx, fn);
}

/** Logs one AI call. Never throws: a failed log must not fail the scoring it describes. */
export async function recordUsage(u: {
  provider: "openai" | "jev";
  model: string;
  input: number;
  cached?: number;
  output: number;
  estimated?: boolean;
}) {
  const ctx = store.getStore();
  if (!ctx) return;
  const tokens = { input: u.input, cached: u.cached ?? 0, output: u.output };
  try {
    await createAdminClient().from("ai_usage").insert({
      recruiter_id: ctx.recruiterId,
      job_id: ctx.jobId,
      provider: u.provider,
      model: u.model,
      purpose: ctx.purpose,
      input_tokens: tokens.input,
      cached_tokens: tokens.cached,
      output_tokens: tokens.output,
      cost_usd: costUsd(u.provider === "jev" ? "jev" : u.model, tokens),
      estimated: u.estimated ?? false,
    });
  } catch (e) {
    console.error("Couldn't log AI usage", e);
  }
}

/** First moment of the current calendar month (UTC): budgets reset then. */
export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
