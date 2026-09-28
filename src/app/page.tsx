import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { DemoButton } from "@/components/DemoButton";
import { SignInDialog } from "@/components/SignInDialog";
import { Icon, type IconName } from "@/components/Icon";
import { safeNext } from "@/lib/next-path";
import { DEMO_CANDIDATES, DEMO_JOB } from "@/lib/demo/fixture";
import { scoreStage1, shareOfRule } from "@/lib/demo/score";

export const metadata: Metadata = {
  title: "reqroot — Hiring decisions, rooted in evidence",
  description:
    "Screen every applicant with AI, see the evidence behind every score, and keep every hiring decision in your hands. Try the live demo — no sign-up.",
  openGraph: {
    title: "reqroot — Hiring decisions, rooted in evidence",
    description: "AI candidate screening that shows its evidence. Try the live demo — no sign-up.",
    type: "website",
  },
};

const CONTACT = "prasadkaushal3@gmail.com";

const STEPS: { icon: IconName; title: string; bullets: string[]; badge: string; tone: string }[] = [
  { icon: "file", title: "Set up the job", bullets: ["Paste the job description", "Get an application form", "Approve a two-stage rubric"], badge: "~5 min setup", tone: "mint" },
  { icon: "users", title: "Screen everyone", bullets: ["Exact checks on structured answers", "AI checks free text and grades answers", "Evidence for every decision"], badge: "Automatic", tone: "sky" },
  { icon: "search", title: "Review the best CVs", bullets: ["You choose who moves on", "AI reads CV, portfolio and GitHub", "Every point cites its source"], badge: "Evidence-backed", tone: "peach" },
  { icon: "calendar", title: "Interview", bullets: ["Move people through your pipeline", "Email from your own Gmail", "Book Google Calendar + Meet"], badge: "Google Workspace", tone: "lilac" },
];

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "file", title: "Evidence for every decision", text: "Click any score to see the answer, the rule and the reasoning behind it — nothing is a black box." },
  { icon: "users", title: "You make the calls", text: "Approving rubrics, moving people on and sending emails are always a person's decision." },
  { icon: "alert", title: "Bias review built in", text: "Rubrics can't go live without a bias review that points out proxies like graduation year or “culture fit”." },
  { icon: "refresh", title: "Confidence you can act on", text: "When the first AI pass is unsure, a second model decides and the candidate is flagged for your review." },
  { icon: "calendar", title: "Every version kept", text: "Each rubric version is saved, so any past score can be traced to the criteria that produced it." },
  { icon: "check", title: "Cost-aware by design", text: "Cheap checks for every applicant, deep CV reviews only for people you choose, and a monthly AI budget." },
];

const initials = (n: string) => n.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
const clip = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
/** "Aditi Kulkarni" → "Aditi K." for tight lists. */
const short = (n: string) => { const [f, l] = n.split(/\s+/); return l ? `${f} ${l[0]}.` : f; };

/** The sample job, scored exactly as the demo scores it. */
function demoData() {
  const scored = DEMO_CANDIDATES.map((c) => ({ c, ...scoreStage1(c) }));
  const ranked = scored.filter((x) => !x.rejected).sort((a, b) => b.score - a.score);
  const meera = scored.find((x) => x.c.name === "Meera Pillai")!;
  const answer = (key: string) => (meera.c.answers as Record<string, string>)[key] ?? "";
  const rows = meera.finals.map((f) => {
    const share = shareOfRule(f.r.weight);
    const met = f.decision === "pass" || f.decision === "meets";
    const partly = f.decision === "borderline" || f.decision === "unclear";
    return {
      key: f.r.key, name: f.r.name, met, partly,
      points: met ? `+${share}%` : partly ? `+${share / 2}% of ${share}%` : `0% of ${share}%`,
      note: f.by === "rule" ? `Answered “${answer(f.r.key)}” — checked exactly.` : `“${clip(answer(f.r.key))}”`,
    };
  });
  return { ranked, meera, rows };
}

export default async function Landing({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  // Signed-in people go straight to their work (a guest to their demo job); ?home=1 shows this page.
  if (claims?.sub && sp.home !== "1") {
    const next = safeNext(typeof sp.next === "string" ? sp.next : null);
    if (next) redirect(next);
    if (claims.is_anonymous === true) {
      const { data: job } = await supabase.from("jobs").select("id").order("created_at").limit(1).maybeSingle();
      redirect(job ? `/jobs/${job.id}` : "/jobs");
    }
    redirect("/jobs");
  }
  const signedIn = !!claims?.sub;
  const { ranked, meera, rows } = demoData();
  const hero = ["notice", "project", "city", "prio"].map((k) => rows.find((r) => r.key === k)!).filter(Boolean);

  const primary = signedIn
    ? <Link className="pillbtn btn-lime" href="/jobs" style={{ textDecoration: "none" }}>Open reqroot</Link>
    : <DemoButton />;

  return (
    <div className="landing">
      <header className="lp-nav">
        <Link className="logo" href="/">req<span>root</span></Link>
        <nav aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#try">Try it</a>
        </nav>
        <span className="spacer" />
        {signedIn ? (
          <Link className="pillbtn btn-dark btn-sm" href="/jobs" style={{ textDecoration: "none" }}>Open reqroot</Link>
        ) : (
          <>
            <Link className="pillbtn btn-ghost btn-sm" href="/?signin=1" scroll={false} style={{ textDecoration: "none" }}>Sign in</Link>
            <DemoButton className="pillbtn btn-lime btn-sm" />
          </>
        )}
      </header>

      <section className="lp-hero">
        <div>
          <p className="eyebrow">AI candidate screening</p>
          <h1 className="hero">Hiring decisions, rooted in <em>evidence.</em></h1>
          <p className="lede">Screen every applicant with AI, see the evidence behind every score, and keep every hiring decision in your hands.</p>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            {primary}
            <a className="pillbtn btn-ghost" href="#how" style={{ textDecoration: "none" }}>See how it works</a>
          </div>
          <ul className="lp-trust">
            <li><span className="stat-ico"><Icon name="check" size={16} /></span><div><b>No sign-up</b><span>to try the demo</span></div></li>
            <li><span className="stat-ico"><Icon name="refresh" size={16} /></span><div><b>Real AI scoring</b><span>on a sample job</span></div></li>
            <li><span className="stat-ico"><Icon name="clock" size={16} /></span><div><b>Fictional data</b><span>deleted in 24 hours</span></div></li>
          </ul>
        </div>

        <div className="lp-mock" aria-label="Example of a scored candidate from the demo">
          <div className="lp-mock-head">
            <span className="avatar mint">{initials(meera.c.name)}</span>
            <div><b>{meera.c.name}</b><span>{DEMO_JOB.title}</span></div>
            <span className="lp-score"><b className="mono">{meera.score}</b><small>/ 100</small></span>
          </div>
          <div className="lp-mock-row">
            <span className="chip good">High confidence {meera.agg.confidence.toFixed(2)}</span>
            <span className="chip lime">Stage 1: qualified</span>
          </div>
          <ul className="lp-evidence">
            {hero.map((r) => (
              <li key={r.key}>
                <span className={r.met ? "ok" : "warn"}>{r.met ? "✓" : "½"}</span>
                <div><b>{r.name}</b><span>{r.note}</span></div>
                <em className="mono">{r.points}</em>
              </li>
            ))}
          </ul>
          <div className="lp-mock-foot">
            <span className="muted">Why they ranked here</span>
            <p>{meera.reason}</p>
            {signedIn ? null : <DemoButton label="View full reasoning →" className="btn-link" />}
          </div>
        </div>
      </section>

      <section id="how" className="lp-section">
        <p className="eyebrow">How it works</p>
        <h2>From application to interview, with the reasoning attached.</h2>
        <p className="lp-sub">Every step shows its work — and every decision stays yours.</p>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="lp-step">
              <span className={`lp-step-ico ${s.tone}`}><Icon name={s.icon} size={18} /></span>
              <h3><span className="mono">{i + 1}.</span> {s.title}</h3>
              <StepVisual i={i} ranked={ranked.slice(0, 3).map((x) => ({ name: x.c.name, score: x.score }))} />
              <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
              <span className={`chip ${s.tone === "peach" ? "warn" : s.tone === "sky" ? "sky" : s.tone === "lilac" ? "neutral" : "good"}`}>{s.badge}</span>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" className="lp-section">
        <p className="eyebrow">Why reqroot</p>
        <h2>Screening you can explain to a hiring manager — and a candidate.</h2>
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

      <section id="try" className="lp-try">
        <div className="lp-try-copy">
          <p className="eyebrow">Try it yourself</p>
          <h2>See how reqroot scores a real Product Manager job.</h2>
          <ul className="lp-checks">
            <li><Icon name="check" size={16} /> {DEMO_CANDIDATES.length} applicants, already screened</li>
            <li><Icon name="check" size={16} /> Scores, rules and reasoning for every one</li>
            <li><Icon name="check" size={16} /> Submit your own application and watch it get scored</li>
            <li><Icon name="check" size={16} /> The full workflow, with no sign-up</li>
          </ul>
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            {primary}
            {!signedIn && <Link className="pillbtn btn-ghost" href="/?signin=1" scroll={false} style={{ textDecoration: "none" }}>Sign in</Link>}
          </div>
        </div>
        <div className="lp-preview" aria-label="Preview of the demo's ranked candidates">
          <div className="lp-preview-head"><span className="chip lime">Demo</span><b>{DEMO_JOB.title}</b></div>
          <div className="lp-preview-body">
            <ol className="lp-rank">
              {ranked.slice(0, 5).map((x, i) => (
                <li key={x.c.name} className={x.c.name === meera.c.name ? "on" : ""}>
                  <span className="mono rk">{ranked.findIndex((y) => y.score === x.score) + 1}{ranked.filter((y) => y.score === x.score).length > 1 ? "=" : ""}</span>
                  <span className="avatar mint">{initials(x.c.name)}</span>
                  <span className="nm">{short(x.c.name)}</span>
                  <span className="bar"><i style={{ width: `${x.score}%` }} /></span>
                  <b className="mono">{x.score}</b>
                  <span className="sr-only">rank {i + 1}</span>
                </li>
              ))}
            </ol>
            <div className="lp-why">
              <b>Why {meera.c.name.split(" ")[0]} scored {meera.score}</b>
              <ul>
                {rows.map((r) => (
                  <li key={r.key}><span className={r.met ? "ok" : "warn"}>{r.met ? "✓" : "½"}</span><span className="nm">{r.name}</span><em className="mono">{r.points}</em></li>
                ))}
              </ul>
              {signedIn ? null : <DemoButton label="View full reasoning →" className="btn-link" />}
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div>
          <span className="logo" style={{ fontSize: 17 }}>req<span>root</span></span>
          <p className="muted">Hiring decisions, rooted in evidence · Built by Kaushal Prasad</p>
        </div>
        <nav aria-label="Footer">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href={`mailto:${CONTACT}`}>Contact</a>
        </nav>
      </footer>

      <Suspense fallback={null}><SignInDialog /></Suspense>
    </div>
  );
}

/** Small interface sketches for each step, drawn in HTML so they stay sharp and follow the theme. */
function StepVisual({ i, ranked }: { i: number; ranked: { name: string; score: number }[] }) {
  if (i === 0) {
    return (
      <div className="lp-vis">
        <span className="ln w90" /><span className="ln w70" /><span className="ln w80" />
        <span className="chip good mini" style={{ justifySelf: "start" }}><Icon name="check" size={11} /> Rubric v1 approved</span>
      </div>
    );
  }
  if (i === 1) {
    return (
      <div className="lp-vis rules">
        <span><b>Notice ≤ 60 days</b><em className="chip neutral mini">Exact</em><i className="ok">✓</i></span>
        <span><b>Based in Pune</b><em className="chip sky mini">AI check</em><i className="ok">✓</i></span>
        <span><b>Prioritisation</b><em className="chip lime mini">AI-graded</em><i className="warn">½</i></span>
      </div>
    );
  }
  if (i === 2) {
    return (
      <div className="lp-vis ranklist">
        {ranked.map((r) => (
          <span key={r.name}><b>{r.name.split(" ")[0]}</b><span className="bar"><i style={{ width: `${r.score}%` }} /></span><em className="mono">{r.score}</em></span>
        ))}
      </div>
    );
  }
  return (
    <div className="lp-vis cols">
      <span><b>Phone screen</b><i /></span>
      <span><b>Onsite</b><i /></span>
      <span><b>Offer</b></span>
    </div>
  );
}
