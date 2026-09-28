import Link from "next/link";

/** Shared layout for the Privacy and Terms pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="landing legal">
      <header className="lp-nav">
        <Link className="logo" href="/">req<span>root</span></Link>
        <span className="spacer" />
        <Link className="pillbtn btn-ghost btn-sm" href="/" style={{ textDecoration: "none" }}>Back to home</Link>
      </header>
      <article className="legal-body">
        <h1>{title}</h1>
        <p className="muted">Last updated {updated}</p>
        {children}
      </article>
    </div>
  );
}
