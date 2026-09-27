"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { useAction } from "@/components/Toast";
import { setJobOpen } from "@/app/actions/jobs";

/** The "⋮" menu on a job card: open, create similar, close/reopen, delete. */
export function JobMenu({ jobId, status }: { jobId: string; status: "open" | "closed" }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggleStatus = async () => {
    setOpen(false);
    const r = await run(() => setJobOpen(jobId, status === "closed"));
    if (r.ok) router.refresh();
  };

  return (
    <div className="menu" ref={ref}>
      <button className="iconbtn" aria-label="Job actions" aria-haspopup="menu" aria-expanded={open} disabled={pending} onClick={() => setOpen((o) => !o)}>
        {pending ? <span className="spin" /> : <Icon name="more" />}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <Link role="menuitem" href={`/jobs/${jobId}`}>Open job</Link>
          <Link role="menuitem" href={`/jobs/${jobId}/candidates`}>View candidates</Link>
          <Link role="menuitem" href={`/jobs?from=${jobId}`}>Create similar job</Link>
          <button role="menuitem" onClick={toggleStatus}>{status === "closed" ? "Reopen job" : "Close job"}</button>
          <Link role="menuitem" className="danger-item" href={`/jobs/${jobId}/setup#delete`}>Delete…</Link>
        </div>
      )}
    </div>
  );
}
