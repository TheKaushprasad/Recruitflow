"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { syncNow } from "@/app/actions/jobs";
import { timeAgo } from "@/lib/format";
import { Icon } from "./Icon";
import { useAction } from "./Toast";

// Re-render the relative time every 30s without a server round trip.
const subscribe = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };
const minuteNow = () => Math.floor(Date.now() / 30_000);

/** "Synced 2 min ago ↻": forms sync automatically, so this is status first and a manual refresh second. */
export function SyncStatus({ jobId, lastSyncedAt, error }: { jobId: string; lastSyncedAt: string | null; error: string | null }) {
  const router = useRouter();
  const { run, pending } = useAction();
  useSyncExternalStore(subscribe, minuteNow, () => 0);
  const text = error ? "Sync failed" : lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}` : "Not synced yet";
  return (
    <span className={`syncstatus${error ? " bad" : ""}`} title={error ?? "Responses sync automatically every couple of minutes"}>
      <span suppressHydrationWarning>{text}</span>
      <button className="iconbtn" aria-label="Sync now" title="Sync now" disabled={pending}
        onClick={async () => { const r = await run(() => syncNow(jobId)); if (r.ok) router.refresh(); }}>
        {pending ? <span className="spin" /> : <Icon name="refresh" size={16} />}
      </button>
    </span>
  );
}
