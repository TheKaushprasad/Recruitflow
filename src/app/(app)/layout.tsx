import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/supabase/server";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  const m = user.user_metadata;
  return (
    <div className="shell">
      <AppHeader email={user.email ?? ""} name={str(m.full_name) ?? str(m.name)} avatar={str(m.avatar_url) ?? str(m.picture)} />
      <main className="shell-main">
        <div className="wrap">{children}</div>
      </main>
    </div>
  );
}
