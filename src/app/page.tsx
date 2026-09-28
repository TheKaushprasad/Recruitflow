import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DemoButton } from "@/components/DemoButton";
import { Icon, type IconName } from "@/components/Icon";

export const metadata: Metadata = {
  title: "reqroot — Hiring decisions, rooted in evidence",
  description:
    "AI candidate screening that shows its evidence. reqroot scores every applicant against your rubric, explains each decision, and leaves every call to you.",
};

const STEPS = [
  { n: "01", title: "Set up the job", text: "Paste the job description. reqroot builds the application form and drafts a two-stage rubric you review and approve." },
  { n: "02", title: "Screen everyone", text: "Every applicant is checked on their form answers the moment they apply — exact rules, AI checks and graded answers, each with evidence." },
  { n: "03", title: "Review the best CVs", text: "Move the people you like to stage 2. AI reads their CV, portfolio and GitHub against the role and cites where every point came from." },
  { n: "04", title: "Interview", text: "A pipeline board, emails from your own Gmail, and interviews booked on Google Calendar with Meet links." },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Evidence for every decision", text: "Click any score to see the answer, the rule and the reasoning behind it — nothing is a black box." },
  { icon: "users", title: "You make the calls", text: "Approving rubrics, moving people on and sending emails are always a person's decision." },
  { icon: "alert", title: "Bias review built in", text: "Rubrics can't go live without a bias review that points out proxies like graduation year or “culture fit”." },
  { icon: "refresh", title: "Confidence you can act on", text: "When the first AI pass is unsure, a second model decides and the candidate is flagged for your review." },
  { icon: "calendar", title: "Every version kept", text: "Each rubric version is saved, so any past score can be traced to the criteria that produced it." },
  { icon: "check", title: "Cost-aware by design", text: "Cheap checks for every applicant, deep CV reviews only for people you choose, and a monthly AI budget." },
];

export default async function Landing() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;
  const guest = data?.claims?.is_anonymous === true;

  return (
    <div className="landing">
      <header className="lp-nav">
        <Link className="logo" href="/">req<span>root</span></Link>
        <nav aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
        </nav>
        <span className="spacer" />
        {signedIn ? (
          <Link className="pillbtn btn-dark btn-sm" href="/jobs" style={{ textDecoration: "none" }}>{guest ? "Back to the demo" : "Open reqroot"}</Link>
        ) : (
          <Link className="pillbtn btn-ghost btn-sm" href="/login" style={{ textDecoration: "none" }}>Sign in</Link>
        )}
      </header>

      <section className="lp-hero">
        <div>
          <p className="eyebrow">AI candidate screening</p>
          <h1 className="hero">Hiring decisions, rooted in evidence.</h1>
          <p className="lede">
            reqroot screens every applicant against your rubric, shows the evidence behind each decision, and leaves every call to you.
          </p>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            {signedIn
              ? <Link className="pillbtn btn-lime" href="/jobs" style={{ textDecoration: "none" }}>{guest ? "Back to the demo" : "Open reqroot"}</Link>
              : <DemoButton />}
            {!signedIn && <Link className="pillbtn btn-ghost" href="/login" style={{ textDecoration: "none" }}>Sign in</Link>}
          </div>
          {!signedIn && <p className="hint" style={{ marginTop: 12 }}>No sign-up. A sample workspace with real AI scoring, deleted after 24 hours.</p>}
        </div>

        <div className="lp-mock" aria-label="Example of a scored candidate">
          <div className="lp-mock-head">
            <span className="avatar mint">MP</span>
            <div><b>Meera Pillai</b><span>Product Manager — AI Platform</span></div>
            <span className="lp-score"><b className="mono">89</b><small>/ 100</small></span>
          </div>
          <div className="lp-mock-row">
            <span className="chip good">High confidence 0.94</span>
            <span className="chip lime">Stage 1</span>
          </div>
          <ul className="lp-evidence">
            <li><span className="ok">✓</span><div><b>Notice period ≤ 60 days</b><span>Answered “30 days” — checked exactly.</span></div></li>
            <li><span className="ok">✓</span><div><b>Shipped an AI/ML product</b><span>“LLM contract summarisation… review time dropped 45%.”</span></div></li>
            <li><span className="ok">✓</span><div><b>Based in Pune or relocating</b><span>“Hyderabad, willing to relocate to Pune.”</span></div></li>
            <li><span className="warn">½</span><div><b>Evidence-based prioritisation</b><span>Partly met — a sound method, but no concrete trade-off.</span></div></li>
          </ul>
          <div className="lp-mock-foot">
            <span className="muted">Why they ranked here</span>
            <p>Excellent LLM launch with a rigorous evaluation set and a 45% outcome; meets every filter.</p>
            <span className="pillbtn btn-lime btn-xs" aria-hidden="true">Move to stage 2</span>
          </div>
        </div>
      </section>

      <section id="how" className="lp-section">
        <p className="eyebrow">How it works</p>
        <h2>From application to interview, with the reasoning attached</h2>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <div key={s.n} className="lp-step"><span className="mono">{s.n}</span><h3>{s.title}</h3><p>{s.text}</p></div>
          ))}
        </div>
      </section>

      <section id="features" className="lp-section">
        <p className="eyebrow">Why reqroot</p>
        <h2>Screening you can explain to a hiring manager — and a candidate</h2>
        <div className="lp-features">
          {FEATURES.map((f) => (
            <div key={f.title} className="lp-feature">
              <span className="stat-ico"><Icon name={f.icon} size={18} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-cta">
        <h2>See it on a real job in under a minute</h2>
        <p>A sample Product Manager role with 11 applicants, already screened. Submit your own test application and watch it get scored.</p>
        {signedIn
          ? <Link className="pillbtn btn-lime" href="/jobs" style={{ textDecoration: "none" }}>{guest ? "Back to the demo" : "Open reqroot"}</Link>
          : <DemoButton />}
      </section>

      <footer className="lp-foot">
        <span className="logo" style={{ fontSize: 16 }}>req<span>root</span></span>
        <span className="muted">Hiring decisions, rooted in evidence · Built by Kaushal Prasad</span>
      </footer>
    </div>
  );
}
