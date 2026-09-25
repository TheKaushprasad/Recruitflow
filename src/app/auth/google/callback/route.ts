import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { saveConnection } from "@/lib/google/auth";

export async function GET(request: NextRequest) {
  const { user } = await requireUser();
  const url = new URL(request.url);
  const back = (status: string) => {
    const res = NextResponse.redirect(new URL(`/integrations?google=${status}`, url.origin));
    res.cookies.delete({ name: "g_oauth_state", path: "/auth/google" });
    return res;
  };

  const state = url.searchParams.get("state");
  if (!state || state !== request.cookies.get("g_oauth_state")?.value) return back("state");
  if (url.searchParams.get("error")) return back("denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error");
  try {
    await saveConnection(user.id, code);
    return back("connected");
  } catch (e) {
    console.error("Google connect failed", e);
    return back("error");
  }
}
