"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a job's server-rendered data fresh without a manual reload:
 * - Realtime: refreshes (debounced) whenever a candidate or stage-2 review for the job changes.
 * - Polling fallback every 4s while `busy` (scoring or a CV review is running), in case
 *   a realtime event is missed.
 */
export function useLiveRefresh(jobId: string, busy: boolean) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => router.refresh(), 400); // batch bursts of row updates into one refresh
    };
    const filter = `job_id=eq.${jobId}`;
    const ch = supabase
      .channel(`live-${jobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "candidates", filter }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "deep_evaluations", filter }, refresh)
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(ch);
    };
  }, [jobId, router]);

  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(i);
  }, [busy, router]);
}
