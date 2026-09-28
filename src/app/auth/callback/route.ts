import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/next-path";

// Supabase magic-link / OAuth sign-in lands here with ?code= (and ?next= to return to).
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next ?? "/jobs", url.origin));
  }
  const back = new URL("/", url.origin);
  back.searchParams.set("signin", "1");
  back.searchParams.set("error", url.searchParams.get("error_description") ? "provider" : "link");
  if (next) back.searchParams.set("next", next);
  return NextResponse.redirect(back);
}
