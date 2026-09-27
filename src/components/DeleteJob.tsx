"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "./Toast";
import { deleteJob } from "@/app/actions/jobs";

export function DeleteJob({ jobId, title, candidates }: { jobId: string; title: string; candidates: number }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <div className="panel danger" id="delete" style={{ marginTop: 32, scrollMarginTop: 24 }}>
      <h3 style={{ marginBottom: 6 }}>Delete this job</h3>
      <p className="hint" style={{ margin: "0 0 14px" }}>
        Permanently removes the job, its {candidates} candidate{candidates === 1 ? "" : "s"}, every score and rubric version, the pipeline and interview records.
        Your Google Form, response Sheet, sent emails and calendar events stay in your Google account.
        To keep the history instead, close the job.
      </p>
      {open ? (
        <form
          className="row"
          style={{ alignItems: "flex-end" }}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => deleteJob(jobId, typed));
            if (r.ok) router.push("/jobs?deleted=1");
          }}
        >
          <div style={{ flex: "1 1 260px" }}>
            <label className="f" htmlFor="confirmTitle">Type <b>{title}</b> to confirm</label>
            <input id="confirmTitle" type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
          <button type="button" className="pillbtn btn-ghost btn-sm" onClick={() => { setOpen(false); setTyped(""); }}>Cancel</button>
          <button type="submit" className="pillbtn btn-danger btn-sm" disabled={pending || typed.trim() !== title.trim()}>
            {pending ? <span className="spin" /> : "Delete permanently"}
          </button>
        </form>
      ) : (
        <button className="pillbtn btn-danger btn-sm" onClick={() => setOpen(true)}>Delete job…</button>
      )}
    </div>
  );
}
