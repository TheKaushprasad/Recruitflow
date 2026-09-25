import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { runJob } from "@/lib/pipeline";
import type { Job } from "@/lib/types";

export const maxDuration = 300;

// Called every few minutes by a scheduler (Vercel Cron, Supabase pg_cron, cron-job.org…)
// with header `Authorization: Bearer <CRON_SECRET>`.
function authorized(req: NextRequest) {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${env.cronSecret()}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 500 });
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: jobs } = await db
    .from("jobs")
    .select("*")
    .eq("status", "open")
    .or("google_form_id.not.is.null,sheet_id.not.is.null");
  const results = [];
  for (const job of (jobs ?? []) as Job[]) {
    results.push({ job: job.id, ...(await runJob(db, job, 8)) });
  }
  return NextResponse.json({ ran: results.length, results });
}
