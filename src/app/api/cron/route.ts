import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { runWorker } from "@/lib/worker";

export const maxDuration = 300;

// The queue worker's heartbeat. Called every minute by Supabase pg_cron (see supabase/cron.sql),
// plus Vercel's daily cron as a fallback, with header `Authorization: Bearer <CRON_SECRET>`.
// Each call syncs due forms and works both scoring queues for up to ~4 minutes.
function authorized(req: NextRequest) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.cronSecret()}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Reply straight away (the scheduler's HTTP call has a short timeout) and keep working after it.
  after(async () => {
    const result = await runWorker(createAdminClient());
    if (result.added || result.scored || result.failed || result.stage2) console.log("worker", result);
  });
  return NextResponse.json({ started: true }, { status: 202 });
}
