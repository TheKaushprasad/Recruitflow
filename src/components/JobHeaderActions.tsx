"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { setJobOpen } from "@/app/actions/jobs";
import { Icon } from "./Icon";
import { Menu } from "./Menu";
import { useAction } from "./Toast";

/** Job page header actions: "Create similar job", the next step for this job, and closing/deleting tucked into ⋮. */
export function JobHeaderActions({ jobId, status, next }: {
  jobId: string;
  status: "open" | "closed";
  /** The context-aware main action ("Review 3 flagged", "Approve the rubric"…). */
  next?: { label: string; href: string } | null;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const setOpen = async (open: boolean) => {
    if (!open && !window.confirm("Close this job? It stops taking new applications. Candidates, scores and history are kept, and you can reopen it any time.")) return;
    const r = await run(() => setJobOpen(jobId, open));
    if (r.ok) router.refresh();
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <Link className="pillbtn btn-ghost btn-sm btn-icon" href={`/jobs?from=${jobId}`} style={{ textDecoration: "none" }}>
        <Icon name="plus" size={15} /> Create similar job
      </Link>
      {next && (
        <Link className="pillbtn btn-lime btn-sm" href={next.href} style={{ textDecoration: "none" }}>{next.label}</Link>
      )}
      <Menu
        label="More job actions"
        busy={pending}
        trigger={<Icon name="more" />}
        items={[
          status === "closed"
            ? { label: "Reopen job", onSelect: () => setOpen(true) }
            : { label: "Close job", onSelect: () => setOpen(false) },
          { label: "Delete job…", href: `/jobs/${jobId}/setup#delete`, danger: true },
        ]}
      />
    </div>
  );
}
