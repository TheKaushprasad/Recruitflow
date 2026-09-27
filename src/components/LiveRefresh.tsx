"use client";

import { useLiveRefresh } from "./useLiveRefresh";

/** Drop-in for server pages: re-renders the page when the job's candidates change. */
export function LiveRefresh({ jobId, busy = false }: { jobId: string; busy?: boolean }) {
  useLiveRefresh(jobId, busy);
  return null;
}
