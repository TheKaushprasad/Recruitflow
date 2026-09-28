"use server";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, requireUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { seedDemo } from "@/lib/demo/seed";
import { GUEST, demoStartBlocked, guestAiBlocked } from "@/lib/guest";
import { workStage1 } from "@/lib/worker";
import { errorMessage } from "@/lib/errors";
import { normalizeUrl } from "@/lib/urls";
import type { ActionResult } from "./jobs";

/**
 * "Try the demo": signs the visitor in anonymously and builds them a sample workspace.
 * Someone already signed in goes straight to their jobs (a returning guest to their demo job).
 */
export async function startDemo(captchaToken?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: session } = await supabase.auth.getClaims();
  if (session?.claims?.sub) {
    if (session.claims.is_anonymous !== true) redirect("/jobs");
    const { data: job } = await supabase.from("jobs").select("id").order("created_at").limit(1).maybeSingle();
    redirect(job ? `/jobs/${job.id}` : "/jobs");
  }

  let jobId: string;
  try {
    const busy = await demoStartBlocked();
    if (busy) return { ok: false, error: busy };
    const { data, error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
    if (error || !data.user) {
      const msg = error?.message ?? "Couldn't start the demo.";
      return { ok: false, error: /anonymous/i.test(msg) ? "The demo is switched off right now. Please sign in instead." : msg };
    }
    const admin = createAdminClient();
    try {
      jobId = await seedDemo(admin, data.user.id);
    } catch (e) {
      // Don't leave a half-built workspace behind.
      await admin.auth.admin.deleteUser(data.user.id).catch(() => {});
      await supabase.auth.signOut().catch(() => {});
      throw e;
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
  redirect(`/jobs/${jobId}`);
}

/**
 * Demo only: a guest types an application and watches it get scored live (Jev + OpenAI),
 * within a small per-guest and per-day allowance.
 */
export async function submitDemoApplication(
  jobId: string,
  input: { name: string; email: string; cvUrl: string; answers: { question: string; answer: string }[] },
): Promise<ActionResult> {
  try {
    const { supabase, user } = await requireUser();
    if (!user.isGuest) return { ok: false, error: "Test applications are part of the demo. Share your form link to collect real ones." };

    const { count } = await supabase.from("candidates").select("id", { count: "exact", head: true }).like("external_id", "demo-app-%");
    if ((count ?? 0) >= GUEST.testApplications) {
      return { ok: false, error: `The demo allows ${GUEST.testApplications} test applications. Create a free account to screen real ones.` };
    }
    const blocked = await guestAiBlocked();
    if (blocked) return { ok: false, error: blocked };

    const { data: job } = await supabase.from("jobs").select("id, current_rubric_id").eq("id", jobId).maybeSingle();
    if (!job) return { ok: false, error: "Job not found." };
    if (!job.current_rubric_id) return { ok: false, error: "Approve the rubric first — that's what the application is scored against." };

    const name = input.name.trim().slice(0, 80);
    if (!name) return { ok: false, error: "Add a name for the applicant." };
    const answers = input.answers.slice(0, 20).map((a) => ({ question: String(a.question).slice(0, 200), answer: String(a.answer ?? "").slice(0, 3000) }));
    if (!answers.some((a) => a.answer.trim())) return { ok: false, error: "Answer at least one question." };
    const cv = input.cvUrl.trim();
    const resumeUrl = cv ? normalizeUrl(cv) : null;
    if (cv && !resumeUrl) return { ok: false, error: `“${cv}” isn't a valid link.` };
    const email = input.email.trim().slice(0, 120);

    const { error } = await supabase.from("candidates").insert({
      recruiter_id: user.id, job_id: jobId, external_id: `demo-app-${randomUUID()}`, name,
      email: /\S+@\S+\.\S+/.test(email) ? email : null, resume_url: resumeUrl,
      answers: [{ question: "Full name", answer: name }, ...answers], submitted_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: errorMessage(error) };

    after(async () => {
      await workStage1(createAdminClient(), { jobId, deadline: Date.now() + 120_000 });
    });
    revalidatePath(`/jobs/${jobId}`, "layout");
    return { ok: true, message: `${name} applied — scoring now. It appears at the top of the list in a few seconds.` };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
