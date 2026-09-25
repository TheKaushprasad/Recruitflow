"use client";

import { useRouter } from "next/navigation";

export function JobFilter({ jobs, job, status }: { jobs: { id: string; title: string; closed: boolean }[]; job: string; status: string }) {
  const router = useRouter();
  const go = (next: { job?: string; status?: string }) => {
    const p = new URLSearchParams();
    const j = next.job ?? job;
    const s = next.status ?? status;
    if (j) p.set("job", j);
    if (s) p.set("status", s);
    router.push(`/emails${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return (
    <div className="row" style={{ gap: 8 }}>
      <select id="historyJob" aria-label="Filter by job" value={job} onChange={(e) => go({ job: e.target.value })} style={{ width: "auto", maxWidth: 280 }}>
        <option value="">All jobs</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}{j.closed ? " (closed)" : ""}</option>)}
        <option value="none">Deleted jobs</option>
      </select>
      <select id="historyStatus" aria-label="Filter by status" value={status} onChange={(e) => go({ status: e.target.value })} style={{ width: "auto" }}>
        <option value="">Sent and failed</option>
        <option value="failed">Failed only</option>
      </select>
    </div>
  );
}
