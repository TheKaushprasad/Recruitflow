import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Privacy policy — reqroot" };
const CONTACT = "prasadkaushal3@gmail.com";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" updated="28 September 2026">
      <p>
        reqroot helps recruiters screen job applications. This page explains what data reqroot handles, why, who it&apos;s shared with,
        and the choices you have. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>

      <h2>Who is responsible</h2>
      <p>
        For your account, reqroot is responsible for your data. For candidates&apos; applications, <b>the recruiter or company using reqroot</b> decides
        what to collect and how to use it; reqroot processes that data on their behalf.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><b>Account:</b> your email address and, if you sign in with Google, your name and profile photo.</li>
        <li><b>Google connection (optional):</b> an access token for the Google services you connect — Forms, Sheets, Gmail (sending only) and Calendar. It is stored encrypted and used only for the actions you take in reqroot. We never read your inbox or Google Drive.</li>
        <li><b>Hiring data:</b> jobs, rubrics, application answers, CV, portfolio and GitHub links and the content read from them, scores, evidence, pipeline stages, emails you send and interviews you book.</li>
        <li><b>Usage and AI costs:</b> which AI models ran and how many tokens they used, to show your usage and enforce your budget.</li>
        <li><b>Cookies:</b> only what&apos;s needed to keep you signed in. No advertising or tracking cookies.</li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To run reqroot: syncing applications, scoring them against your rubric, showing evidence, and sending the emails and invites you ask for.</li>
        <li>To keep the service secure and working, and to answer your support requests.</li>
        <li>We don&apos;t sell personal data and don&apos;t use it for advertising.</li>
      </ul>

      <h2>AI processing</h2>
      <p>
        Application answers, and the CVs, portfolios and GitHub profiles of candidates you move to stage 2, are sent to our AI providers to be scored:
        <b> OpenAI</b> and <b>TypeSafe (Jev)</b>. They process it to return results to reqroot. Every AI score comes with its evidence, and hiring
        decisions — approving rubrics, moving candidates on, contacting them — are always made by a person.
      </p>

      <h2>Who we share data with</h2>
      <ul>
        <li><b>Supabase</b> — database and sign-in (hosted in Seoul, South Korea).</li>
        <li><b>Vercel</b> — hosting of the app.</li>
        <li><b>OpenAI</b> and <b>TypeSafe</b> — AI scoring, as above.</li>
        <li><b>Google</b> — only for the Google services you connect.</li>
      </ul>
      <p>We may also disclose data if the law requires it.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li><b>Demo workspaces</b> (&ldquo;Try the live demo&rdquo;) contain fictional candidates and are deleted automatically after 24 hours, along with anything you add to them.</li>
        <li><b>Your account and hiring data</b> are kept until you delete them or ask us to. Deleting a job removes its candidates, scores and history from reqroot; your Google Forms, Sheets, sent emails and calendar events stay in your Google account.</li>
      </ul>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Disconnect Google at any time from the Integrations page, or at myaccount.google.com/permissions.</li>
        <li>Ask for a copy of your data, or for it to be corrected or deleted, by emailing <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</li>
        <li><b>Candidates:</b> for a request about an application, contact the company you applied to. If you can&apos;t reach them, email us and we&apos;ll pass it on.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, Google tokens are encrypted at rest, and database rules keep each account&apos;s data visible only to that account.
        No system is perfectly secure; tell us at the address above if you find a problem.
      </p>

      <h2>Changes</h2>
      <p>We&apos;ll update this page when our practices change and change the date at the top. Significant changes will be announced in the app.</p>
    </LegalPage>
  );
}
