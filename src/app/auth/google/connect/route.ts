import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { consentUrl } from "@/lib/google/auth";

// Starts the one-time Google connection (Forms, Sheets, Gmail, Calendar).
export async function GET() {
  await requireUser();
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(consentUrl(state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: true, path: "/auth/google", maxAge: 600 });
  return res;
}
