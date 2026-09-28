import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/supabase/server";
import { GUEST } from "@/lib/guest";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const m = user.user_metadata;
  return (
    <div className="shell">
      <AppHeader
        email={user.isGuest ? "Demo workspace" : user.email ?? ""}
        name={user.isGuest ? "Guest" : str(m.full_name) ?? str(m.name)}
        avatar={user.isGuest ? null : str(m.avatar_url) ?? str(m.picture)}
      />
      <main className="shell-main">
        <div className="wrap">
          {user.isGuest && (
            <div className="demo-banner">
              <span className="demo-tag">Demo</span>
              <p>
                You&apos;re exploring a sample workspace with fictional candidates. Try <b>Submit a test application</b> on the Candidates tab to watch live
                AI scoring. Google features (forms, email, calendar) need a real account, and this demo is deleted after {GUEST.lifetimeHours} hours.
              </p>
              <Link className="pillbtn btn-dark btn-sm" href="/login" style={{ textDecoration: "none" }}>Create a free account</Link>
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
