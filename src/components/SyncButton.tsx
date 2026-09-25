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
        await run(() => syncNow(jobId));
        setTimeout(() => router.refresh(), 8000);
      }}
    >
      {pending ? <span className="spin" /> : label}
    </button>
  );
}
