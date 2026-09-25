"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "./Toast";
import { setJobOpen } from "@/app/actions/jobs";

export function JobStatusButton({ jobId, status }: { jobId: string; status: "open" | "closed" }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [confirm, setConfirm] = useState(false);

  if (status === "closed") {
    return (
      <button className="pillbtn btn-ghost btn-sm" disabled={pending}
        onClick={async () => { const r = await run(() => setJobOpen(jobId, true)); if (r.ok) router.refresh(); }}>
        {pending ? <span className="spin" /> : "Reopen job"}
      </button>
    );
  }
  return confirm ? (
    <div className="row" style={{ gap: 8 }}>
      <span className="hint" style={{ margin: 0 }}>Stops new applications. History stays.</span>
      <button className="pillbtn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep open</button>
      <button className="pillbtn btn-dark btn-sm" disabled={pending}
        onClick={async () => { const r = await run(() => setJobOpen(jobId, false)); setConfirm(false); if (r.ok) router.refresh(); }}>
        {pending ? <span className="spin" /> : "Close job"}
      </button>
    </div>
  ) : (
    <button className="pillbtn btn-ghost btn-sm" onClick={() => setConfirm(true)}>Close job</button>
  );
}
