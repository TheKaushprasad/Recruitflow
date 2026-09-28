"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { submitDemoApplication } from "@/app/actions/demo";
import { Icon } from "./Icon";
import { useAction } from "./Toast";

export interface ApplyQuestion {
  title: string;
  type: string;
  options: string[];
  role: string | null;
}

/** One-click examples for the sample job, so visitors can see a strong and a weak answer scored. */
const EXAMPLES: Record<"strong" | "weak", { name: string; email: string; answers: Record<string, string> }> = {
  strong: {
    name: "Ishaan Verma", email: "ishaan.verma@example.com",
    answers: {
      "Current city": "Pune (Kharadi)",
      "Notice period": "30 days",
      "Expected CTC": "33 LPA",
      "Years of product management experience": "6–8 years",
      "Tell us about an AI or ML product or feature you shipped":
        "I owned smart search for a B2B marketplace. With two ML engineers I scoped a semantic search model, built an evaluation set of 1,000 real queries, and set a target of +10% on click-through. We launched behind an A/B test to 30% of traffic, then everyone. Search-to-order conversion rose 17% and zero-result searches fell by half.",
      "How do you decide what to build next? Share a recent example.":
        "I score ideas on customer impact, revenue and effort using funnel data and ten customer calls a month. Recently that meant shelving bulk ordering, which our biggest client asked for, because search fixes helped far more buyers — we showed them the data and they agreed.",
    },
  },
  weak: {
    name: "Tanya Gupta", email: "tanya.gupta@example.com",
    answers: {
      "Current city": "Delhi",
      "Notice period": "90 days",
      "Expected CTC": "Negotiable",
      "Years of product management experience": "0–2 years",
      "Tell us about an AI or ML product or feature you shipped": "I am very interested in AI and have used ChatGPT a lot for my work.",
      "How do you decide what to build next? Share a recent example.": "Whatever my manager says is the priority.",
    },
  },
};

const IDENTITY = new Set(["name", "email", "resume", "portfolio", "github"]);

/** Demo only: type an application and watch it get scored live. */
export function TestApplication({ jobId, questions, autoOpen = false }: { jobId: string; questions: ApplyQuestion[]; autoOpen?: boolean }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [open, setOpen] = useState(autoOpen);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [cvUrl, setCvUrl] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const fields = questions.filter((q) => !q.role || !IDENTITY.has(q.role));
  const hasExamples = fields.some((q) => q.title in EXAMPLES.strong.answers);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const fill = (k: "strong" | "weak") => {
    setName(EXAMPLES[k].name);
    setEmail(EXAMPLES[k].email);
    setAnswers(EXAMPLES[k].answers);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => submitDemoApplication(jobId, {
      name, email, cvUrl, answers: fields.map((q) => ({ question: q.title, answer: answers[q.title] ?? "" })),
    }));
    if (r.ok) {
      setOpen(false);
      setName(""); setEmail(""); setCvUrl(""); setAnswers({});
      router.refresh();
    }
  }

  return (
    <>
      <button className="pillbtn btn-lime btn-sm btn-icon" onClick={() => setOpen(true)}><Icon name="plus" size={15} /> Submit a test application</button>
      {open && (
        <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <form className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="apply-h" onSubmit={submit}>
            <div className="dhead">
              <div>
                <h2 id="apply-h" style={{ marginBottom: 4 }}>Submit a test application</h2>
                <p className="hint" style={{ margin: 0 }}>Answer as a candidate would. It&apos;s scored live against this job&apos;s rubric — the same way real applications are.</p>
              </div>
              <button type="button" className="iconbtn" aria-label="Close" onClick={() => setOpen(false)}><Icon name="x" /></button>
            </div>
            {hasExamples && (
              <div className="row" style={{ gap: 8, marginBottom: 16 }}>
                <span className="hint" style={{ margin: 0 }}>Quick fill:</span>
                <button type="button" className="pillbtn btn-ghost btn-xs" onClick={() => fill("strong")}>A strong candidate</button>
                <button type="button" className="pillbtn btn-ghost btn-xs" onClick={() => fill("weak")}>A weak candidate</button>
              </div>
            )}
            <div className="apply-grid">
              <div>
                <label className="f" htmlFor="ta-name">Full name</label>
                <input id="ta-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Any name — this is a test" />
              </div>
              <div>
                <label className="f" htmlFor="ta-email">Email <span className="muted">(optional)</span></label>
                <input id="ta-email" type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </div>
              {fields.map((q, i) => {
                const id = `ta-q${i}`;
                const v = answers[q.title] ?? "";
                const set = (val: string) => setAnswers((a) => ({ ...a, [q.title]: val }));
                return (
                  <div key={q.title} className={q.type === "paragraph" ? "span2" : ""}>
                    <label className="f" htmlFor={id}>{q.title}</label>
                    {q.options.length && (q.type === "dropdown" || q.type === "choice") ? (
                      <select id={id} value={v} onChange={(e) => set(e.target.value)}>
                        <option value="">Choose…</option>
                        {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : q.type === "paragraph" ? (
                      <textarea id={id} rows={4} value={v} onChange={(e) => set(e.target.value)} />
                    ) : (
                      <input id={id} type="text" value={v} onChange={(e) => set(e.target.value)} />
                    )}
                  </div>
                );
              })}
              <div className="span2">
                <label className="f" htmlFor="ta-cv">CV link <span className="muted">(optional)</span></label>
                <input id="ta-cv" type="text" value={cvUrl} onChange={(e) => setCvUrl(e.target.value)} placeholder="A public PDF or Google Drive link" />
                <p className="hint">Add one to try a stage 2 CV review on this applicant (one included in the demo). Don&apos;t use a real person&apos;s CV without their permission.</p>
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
              <button type="button" className="pillbtn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
              <button className="pillbtn btn-lime btn-sm" disabled={pending}>{pending ? <span className="spin" /> : "Submit and score"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
