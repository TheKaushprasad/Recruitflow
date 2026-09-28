import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(toSet) {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | undefined;
  user_metadata: Record<string, unknown>;
  /** Signed in anonymously through "Try the demo": a temporary workspace with limits. */
  isGuest: boolean;
}

/**
 * Signed-in recruiter + an RLS-scoped client. Redirects to /login otherwise.
 * Verifies the session token locally (getClaims) and is shared across the layout and page
 * of one request (React cache), so a page render doesn't pay for repeated auth round trips.
 */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const c = data?.claims;
  if (!c?.sub) redirect("/login");
  const user: SessionUser = {
    id: c.sub,
    email: typeof c.email === "string" ? c.email : undefined,
    user_metadata: (c.user_metadata as Record<string, unknown>) ?? {},
    isGuest: c.is_anonymous === true,
  };
  return { supabase, user };
});
