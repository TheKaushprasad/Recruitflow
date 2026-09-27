"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "./jobs";

/** Monthly AI budget in USD; empty clears it (no limit). */
export async function setAiBudget(value: string): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    const t = value.trim();
    const n = t ? Number(t) : null;
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 100_000)) return { ok: false, error: "Enter an amount in US dollars, like 25." };
    const { error } = await supabase
      .from("recruiter_settings")
      .upsert({ recruiter_id: user.id, monthly_ai_budget_usd: n == null ? null : Math.round(n * 100) / 100, updated_at: new Date().toISOString() });
    if (error) return { ok: false, error: errorMessage(error) };
    revalidatePath("/integrations");
    return { ok: true, message: n == null ? "Budget removed — no monthly limit." : `Monthly AI budget set to $${n.toFixed(2)}.` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
