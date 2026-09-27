"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { NewJobForm, type JobOption } from "../NewJobForm";

/** "Create job" button that opens the new-job form in a modal. Opens straight away for ?from=<job>. */
export function CreateJob({ jobs, initialSource, label = "Create job" }: { jobs: JobOption[]; initialSource?: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initialSource));

  const close = () => {
    setOpen(false);
    if (initialSource) router.replace("/jobs", { scroll: false });
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <button className="pillbtn btn-lime btn-icon" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> {label}
      </button>
      {open && (
        <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="newjob-h">
            <div className="dhead">
              <div>
                <h2 id="newjob-h" style={{ marginBottom: 4 }}>Create a new job</h2>
                <p className="hint" style={{ margin: 0 }}>Start blank, or copy the setup of a past job.</p>
              </div>
              <button className="iconbtn" aria-label="Close" onClick={close}><Icon name="x" /></button>
            </div>
            <NewJobForm key={initialSource ?? "blank"} jobs={jobs} initialSource={initialSource} />
          </div>
        </div>
      )}
    </>
  );
}
