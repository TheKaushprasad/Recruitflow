import { AppHeader } from "@/components/AppHeader";
import { requireUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  return (
    <div className="wrap">
      <AppHeader email={user.email ?? ""} />
      <main style={{ paddingTop: 12 }}>{children}</main>
    </div>
  );
}
