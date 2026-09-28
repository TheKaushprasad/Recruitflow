import "server-only";
import { createAdminClient } from "./supabase/admin";

/** Limits for the public guest demo (anonymous sign-ins). Override with environment variables. */
export const GUEST = {
  /** Demo workspaces started per day, across everyone. */
  maxPerDay: Number(process.env.DEMO_MAX_GUESTS_PER_DAY ?? 200),
  /** AI spend per day across all guests, in USD. */
  dailyBudgetUsd: Number(process.env.DEMO_DAILY_BUDGET_USD ?? 2),
  /** Test applications a guest can submit (each is scored live). */
  testApplications: 5,
  /** Stage-2 CV reviews a guest can run themselves (the sample ones don't count). */
  cvReviews: 1,
  /** Hours before a guest workspace is deleted. */
  lifetimeHours: 24,
};

export const GUEST_GOOGLE_MSG =
  "That uses Google (Forms, Gmail, Calendar or Sheets), which isn't available in the demo. Create a free account to connect your Google Workspace.";

async function stats() {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data, error } = await createAdminClient().rpc("guest_stats", { p_since: since });
  if (error) throw new Error(`Couldn't check demo limits: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { guests: number; spend: number } | null;
  return { guests: Number(row?.guests ?? 0), spend: Number(row?.spend ?? 0) };
}

/** Why a new demo can't start right now, or null. */
export async function demoStartBlocked(): Promise<string | null> {
  const s = await stats();
  return s.guests >= GUEST.maxPerDay ? "The demo is very busy today. Please try again tomorrow, or create a free account." : null;
}

/** Why a guest can't run another AI call right now, or null. */
export async function guestAiBlocked(): Promise<string | null> {
  const s = await stats();
  return s.spend >= GUEST.dailyBudgetUsd
    ? "The demo's AI allowance for today is used up — everything already scored is still here to explore. Try again tomorrow, or create a free account."
    : null;
}
