import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "../env";

/**
 * Service-role client. Bypasses RLS — only for background jobs (sync, scoring)
 * and token storage. Always filter by recruiter_id explicitly.
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
