import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth", "/api/cron", "/privacy", "/terms", "/opengraph-image"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(toSet, headers) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
        },
      },
    },
  );

  // getClaims refreshes an expiring session and verifies the token locally (signing keys),
  // avoiding a round trip to Supabase Auth on every request.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  // The landing page ("/") is public; everything else needs a session (a guest demo counts).
  if (!data?.claims?.sub && path !== "/" && !PUBLIC.some((p) => path.startsWith(p))) {
    // Sign in on the home page, then come back here.
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("signin", "1");
    url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|ico)$).*)"],
};
