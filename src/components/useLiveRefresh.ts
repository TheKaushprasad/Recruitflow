"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a job's server-rendered data fresh without a manual reload:
 * - Realtime: refreshes (debounced) whenever a candidate or stage-2 review for the job changes.
 * - Polling fallback in case a realtime event is missed: every 4s while `busy` (scoring or a CV
 *   review is running), every 10s while candidates are only `waiting` to be scored.
 */
export function useLiveRefresh(jobId: string, busy: boolean, waiting = false) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let ch: RealtimeChannel | null = null;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => router.refresh(), 400); // batch bursts of row updates into one refresh
    };
    (async () => {
      // Subscribe as the signed-in user: row security decides which changes we may receive,
      // so the socket needs the session token before the channel joins.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      const filter = `job_id=eq.${jobId}`;
      ch = supabase
        .channel(`live-${jobId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "candidates", filter }, refresh)
        .on("postgres_changes", { event: "*", schema: "public", table: "deep_evaluations", filter }, refresh)
        .subscribe();
    })();
    return () => {
      cancelled = true;
      clearTimeout(t);
      if (ch) supabase.removeChannel(ch);
    };
  }, [jobId, router]);

  useEffect(() => {
    if (!busy && !waiting) return;
    const i = setInterval(() => router.refresh(), busy ? 4000 : 10_000);
    return () => clearInterval(i);
  }, [busy, waiting, router]);
}
