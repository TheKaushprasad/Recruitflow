import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = { title: "Terms of use — reqroot" };
const CONTACT = "prasadkaushal3@gmail.com";

export default function Terms() {
  return (
    <LegalPage title="Terms of use" updated="28 September 2026">
      <p>These terms apply when you use reqroot. By signing in or starting a demo, you agree to them. Questions: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>

      <h2>The service</h2>
      <p>
        reqroot is an early-stage product. It helps recruiters collect applications, score them against a rubric with AI, and manage interviews.
        Features may change, and the service is provided <b>as is</b>, without guarantees that it will always be available or error-free.
      </p>

      <h2>AI results are advice, not decisions</h2>
      <p>
        AI scores and evidence help you review candidates; they can be wrong. You are responsible for your hiring decisions, and for reviewing
        results before acting on them — especially anything flagged for review or rejected by a filter.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Use reqroot lawfully and fairly. Don&apos;t screen on protected characteristics (such as age, gender, religion, caste, disability or marital status) or obvious stand-ins for them.</li>
        <li>Tell candidates how their application will be processed, and have a lawful basis to process it — including sharing it with AI providers.</li>
        <li>Only add CVs, links or data you have the right to use.</li>
        <li>Keep your account secure, and don&apos;t misuse the service (for example, overloading it, scraping it or trying to access other accounts).</li>
      </ul>

      <h2>The demo</h2>
      <p>The live demo uses fictional candidates, has usage limits, and is deleted after 24 hours. Don&apos;t enter real candidates&apos; personal data in it.</p>

      <h2>Your data</h2>
      <p>You own the data you put into reqroot. You let us store and process it only to provide the service, as described in the <a href="/privacy">Privacy policy</a>.</p>

      <h2>Third-party services</h2>
      <p>reqroot relies on services such as Google, OpenAI, TypeSafe, Supabase and Vercel. Their availability and terms also affect what reqroot can do.</p>

      <h2>Limitation of liability</h2>
      <p>
        To the extent the law allows, reqroot isn&apos;t liable for indirect or consequential losses, or for decisions made using its results.
        Nothing in these terms limits liability that can&apos;t be limited by law.
      </p>

      <h2>Ending use</h2>
      <p>You can stop using reqroot and ask us to delete your data at any time. We may suspend accounts that break these terms.</p>

      <h2>Changes and law</h2>
      <p>We may update these terms and will change the date at the top when we do. These terms are governed by the laws of India.</p>
    </LegalPage>
  );
}
