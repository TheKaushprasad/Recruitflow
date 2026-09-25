"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function JobTabs({ jobId, candidates, rubricAttention }: { jobId: string; candidates: number; rubricAttention: boolean }) {
  const path = usePathname();
  const base = `/jobs/${jobId}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/setup`, label: "Job setup" },
    { href: `${base}/rubric`, label: "Rubric", dot: rubricAttention },
    { href: `${base}/candidates`, label: "Candidates", count: candidates },
    { href: `${base}/pipeline`, label: "Pipeline" },
    { href: `${base}/history`, label: "History" },
  ];
  return (
    <nav className="tabs" aria-label="Job sections">
      {tabs.map((t) => {
        const active = t.href === base ? path === base : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className="tab">
            {t.label}
            {t.count != null && <span className="count">{t.count}</span>}
            {t.dot && <span className="dot" title="Needs your review" />}
          </Link>
        );
      })}
    </nav>
  );
}
