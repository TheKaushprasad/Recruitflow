"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

/** A small dropdown menu: the trigger is any content (an icon, "Export ▾"), items are actions or links. */
export function Menu({ trigger, label, items, className = "iconbtn", busy }: {
  trigger: React.ReactNode;
  label: string;
  items: MenuItem[];
  className?: string;
  busy?: boolean;
}) {
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

  return (
    <div className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className={className} aria-label={label} aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
        {busy ? <span className="spin" /> : trigger}
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {items.map((it) =>
            it.href ? (
              <Link key={it.label} role="menuitem" href={it.href} className={it.danger ? "danger-item" : undefined} onClick={() => setOpen(false)}>{it.label}</Link>
            ) : (
              <button key={it.label} role="menuitem" disabled={it.disabled} title={it.hint} className={it.danger ? "danger-item" : undefined}
                onClick={() => { setOpen(false); it.onSelect?.(); }}>
                {it.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
