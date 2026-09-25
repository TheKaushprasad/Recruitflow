"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/jobs", label: "Jobs" },
  { href: "/emails", label: "Emails" },
  { href: "/integrations", label: "Integrations" },
];

export function AppHeader({ email }: { email: string }) {
  const path = usePathname();
  return (
    <header className="top">
      <Link className="logo" href="/jobs">
        recruit<span>flow</span>
      </Link>
      <nav className="nav-links" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path.startsWith(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="spacer" />
      <span className="muted" style={{ fontSize: 13 }}>{email}</span>
      <form action="/auth/signout" method="post">
        <button className="pillbtn btn-ghost btn-sm" type="submit">Sign out</button>
      </form>
    </header>
  );
}
