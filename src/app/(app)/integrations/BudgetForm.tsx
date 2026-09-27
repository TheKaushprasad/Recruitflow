"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/Toast";
import { setAiBudget } from "@/app/actions/settings";

export function BudgetForm({ budget }: { budget: number | null }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [value, setValue] = useState(budget == null ? "" : String(budget));
  return (
    <form
      className="row"
      style={{ alignItems: "flex-end", gap: 10 }}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => setAiBudget(value));
        if (r.ok) router.refresh();
      }}
    >
      <div style={{ flex: "0 1 200px" }}>
        <label className="f" htmlFor="budget">Monthly budget (USD)</label>
        <input id="budget" type="number" min={0} step="1" inputMode="decimal" placeholder="No limit" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <button className="pillbtn btn-dark btn-sm" type="submit" disabled={pending}>{pending ? <span className="spin" /> : "Save"}</button>
    </form>
  );
}
