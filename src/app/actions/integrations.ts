"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { disconnect } from "@/lib/google/auth";
import type { ActionResult } from "./jobs";

export async function disconnectGoogle(): Promise<ActionResult> {
  const { user } = await requireUser();
  await disconnect(user.id);
  revalidatePath("/integrations");
  return { ok: true, message: "Google disconnected and access revoked." };
}
