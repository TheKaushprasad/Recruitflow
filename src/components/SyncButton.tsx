"use client";

import { useRouter } from "next/navigation";
import { syncNow } from "@/app/actions/jobs";
import { useAction } from "./Toast";

export function SyncButton({ jobId, label = "Sync now" }: { jobId: string; label?: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  return (
    <button
      className="pillbtn btn-ghost btn-sm"
      disabled={pending}
      onClick={async () => {
        // New responses are already saved when this returns; scores then stream in live.
        const r = await run(() => syncNow(jobId));
        if (r.ok) router.refresh();
      }}
    >
      {pending ? <span className="spin" /> : label}
    </button>
  );
}
