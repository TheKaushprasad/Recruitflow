"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";

const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/jobs", label: "Jobs", icon: "briefcase" },
  { href: "/emails", label: "Emails", icon: "mail" },
  { href: "/integrations", label: "Integrations", icon: "plug" },
];

/** Sidebar on desktop; a top bar with a slide-down menu on phones. */
export function AppHeader({ email, name, avatar }: { email: string; name: string | null; avatar: string | null }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const initials = (name ?? email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join("");

  return (
    <aside className="side" data-open={open || undefined}>
      <div className="side-top">
        <Link className="logo" href="/jobs">req<span>root</span></Link>
        <button className="iconbtn side-toggle" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "x" : "menu"} size={20} />
        </button>
      </div>
      <nav className="side-nav" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => setOpen(false)} aria-current={path.startsWith(l.href) ? "page" : undefined}>
            <Icon name={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="side-user">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={34} height={34} referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar" aria-hidden="true">{initials}</span>
        )}
        <div className="who">
          <b>{name ?? "Signed in"}</b>
          <span title={email}>{email}</span>
        </div>
        <form action="/auth/signout" method="post">
          <button className="iconbtn" type="submit" aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </form>
      </div>
    </aside>
  );
}
