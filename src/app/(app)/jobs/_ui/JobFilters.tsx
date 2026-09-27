"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";

import { SORTS } from "./sorts";

/** Search updates as you type; location and sort only appear once there are enough jobs to need them. */
export function JobFilters({ locations, showMore }: { locations: string[]; showMore: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [busy, start] = useTransition();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value); else next.delete(key);
    start(() => router.replace(`${path}?${next}`, { scroll: false }));
  };
  useEffect(() => {
    if (q === (sp.get("q") ?? "")) return;
    const t = setTimeout(() => set("q", q.trim()), 250);
    return () => clearTimeout(t);
  });

  return (
    <div className="jobfilters" aria-busy={busy}>
      <label className="searchbox">
        <Icon name="search" size={16} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jobs by title or location" aria-label="Search jobs" />
      </label>
      {showMore && (
        <>
          <select aria-label="Location" value={sp.get("loc") ?? ""} onChange={(e) => set("loc", e.target.value)}>
            <option value="">All locations</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select aria-label="Sort" value={sp.get("sort") ?? "newest"} onChange={(e) => set("sort", e.target.value === "newest" ? "" : e.target.value)}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </>
      )}
    </div>
  );
}
