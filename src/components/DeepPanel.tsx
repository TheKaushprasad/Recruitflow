"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "./Toast";
import { moveToStage2, removeFromStage2, saveCandidateLinks, startDeepEvaluation } from "@/app/actions/deep";
import { DECISION_LABEL, confLevel } from "@/lib/format";
import { providerLabel } from "@/lib/ai/provider";
import type { CandidateRow } from "@/lib/data";
import type { DeepEvaluation } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = { form: "Form", cv: "CV", portfolio: "Portfolio", github: "GitHub" };
export const VERDICT: Record<string, [string, "good" | "warn" | "bad"]> = {
  strong: ["Strong fit", "good"],
  possible: ["Possible fit", "warn"],
  weak: ["Weak fit", "bad"],
};

export function deepRunning(d: DeepEvaluation | null) {
  return !!d && (d.status === "queued" || d.status === "running");
}

export function DeepPanel({ jobId, candidate: c, threshold, canEvaluate }: {
  jobId: string;
  candidate: CandidateRow;
  threshold: number;
  canEvaluate: boolean;
}) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [links, setLinks] = useState({
    resume_url: c.resume_url ?? "",
    portfolio_url: c.portfolio_url ?? "",
    github_url: c.github_url ?? "",
  });
  const dirty =
    links.resume_url !== (c.resume_url ?? "") ||
    links.portfolio_url !== (c.portfolio_url ?? "") ||
    links.github_url !== (c.github_url ?? "");
  const d = c.deep;
  const running = deepRunning(d);
  const hasLinks = Object.values(links).some((v) => v.trim());

  /** Not in stage 2 yet → move them (which starts the review); already there → re-run the review. */
  async function evaluate() {
    if (dirty) {
      const saved = await run(() => saveCandidateLinks(c.id, links));
      if (!saved.ok) return;
    }
    await run(() => (c.inStage2 ? startDeepEvaluation(jobId, [c.id]) : moveToStage2(jobId, [c.id])));
    router.refresh();
  }

  return (
    <section className="panel" style={{ margin: "0 0 28px", padding: 20 }}>
      <div className="section-head" style={{ marginBottom: 12, alignItems: "center" }}>
        <div>
          <p className="eyebrow" style={{ margin: "0 0 4px" }}>Stage 2 · CV, portfolio &amp; GitHub review</p>
          <h3>{c.inStage2 ? "In stage 2" : "Still in stage 1"}</h3>
        </div>
        {c.inStage2 ? (
          <button className="btn-link" style={{ fontSize: 13 }} disabled={pending}
            onClick={async () => { await run(() => removeFromStage2(jobId, [c.id])); router.refresh(); }}>
            Move back to stage 1
          </button>
        ) : <span className="chip neutral">Stage 1 score: {c.evaluation && !c.stale ? c.evaluation.score : "—"}</span>}
      </div>

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {([
          ["resume_url", "CV (PDF link)", "https://drive.google.com/file/d/…"],
          ["portfolio_url", "Portfolio / website", "https://…"],
          ["github_url", "GitHub", "https://github.com/username"],
        ] as const).map(([k, label, ph]) => (
          <div key={k} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <label htmlFor={`${k}-${c.id}`} className="f" style={{ margin: 0, width: 130, flex: "none" }}>{label}</label>
            <input id={`${k}-${c.id}`} type="text" value={links[k]} placeholder={ph} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="row">
        <button className="pillbtn btn-lime btn-sm" disabled={pending || running || !canEvaluate || !hasLinks} onClick={evaluate}>
          {running ? <><span className="spin" /> Reviewing…</> : !c.inStage2 ? "Move to stage 2 & review CV" : d?.status === "done" ? "Review again" : "Review CV"}
        </button>
        {dirty && (
          <button className="pillbtn btn-ghost btn-sm" disabled={pending} onClick={async () => { const r = await run(() => saveCandidateLinks(c.id, links)); if (r.ok) router.refresh(); }}>
            Save links
          </button>
        )}
        <span className="hint" style={{ margin: 0 }}>
          {!canEvaluate ? "Approve a rubric first." : !hasLinks ? "Add at least one link." : "About 30–60 seconds. Costs roughly $0.04–0.08."}
        </span>
      </div>
      <p className="hint">CV links must be shared as “Anyone with the link”. PDFs and Google Docs work best.</p>

      {d && <DeepResultView d={d} stale={c.deepStale} threshold={threshold} stage1={c.evaluation && !c.stale ? c.evaluation.score : null} />}
    </section>
  );
}

function DeepResultView({ d, stale, threshold, stage1 }: { d: DeepEvaluation; stale: boolean; threshold: number; stage1: number | null }) {
  if (deepRunning(d)) {
    return <div className="status-box"><span><span className="spin" /> Reading the candidate&apos;s materials and judging each criterion…</span></div>;
  }
  if (d.status === "error") {
    return <div className="banner" style={{ background: "var(--bad-soft)", marginTop: 14 }}><div className="txt"><b style={{ color: "var(--bad)" }}>Evaluation failed.</b> {d.error}</div></div>;
  }
  const [vl, vk] = VERDICT[d.verdict ?? ""] ?? ["—", "warn"];
  const soft = d.results.filter((r) => r.kind === "soft");
  const hard = d.results.filter((r) => r.kind === "hard");
  const rules = d.results.filter((r) => r.kind === "rule");
  const totalW = d.results.filter((r) => r.kind === "soft" || (r.kind === "rule" && r.action === "score")).reduce((a, r) => a + r.weight, 0);

  return (
    <div style={{ marginTop: 18 }}>
      {stale && <div className="note" style={{ margin: "0 0 12px" }}>This evaluation used an older rubric version. Re-evaluate to judge against the current one.</div>}
      <div className="kv" style={{ margin: "0 0 14px" }}>
        <div><small>Suitability</small><b className="mono">{d.score ?? "—"}</b>{stage1 != null && <div className="hint" style={{ margin: 0 }}>Stage 1: {stage1}</div>}</div>
        <div><small>Verdict</small><b style={{ fontSize: 16 }}><span className={`chip ${d.disqualified ? "bad" : vk}`}>{d.disqualified ? "Fails a hard filter" : vl}</span></b></div>
        <div><small>Confidence</small><b className="mono">{d.confidence != null ? Number(d.confidence).toFixed(2) : "—"}</b></div>
      </div>
      {d.summary && <p style={{ margin: "0 0 14px", fontSize: 15 }}>{d.summary}</p>}

      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {d.sources.map((s) => (
          <span key={s.kind} className={`chip ${s.status === "read" ? "good" : s.status === "failed" ? "bad" : "neutral"}`} title={s.note}>
            {SOURCE_LABEL[s.kind]}: {s.status === "read" ? "read" : s.status === "failed" ? "couldn't read" : "not provided"}
          </span>
        ))}
      </div>
      {d.sources.filter((s) => s.status === "failed").map((s) => (
        <p key={s.kind} className="hint" style={{ margin: "-8px 0 12px" }}>{SOURCE_LABEL[s.kind]}: {s.note}</p>
      ))}

      {(d.strengths.length > 0 || d.concerns.length > 0) && (
        <div className="grid2" style={{ gap: 14, marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Strengths</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{d.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 6 }}>Concerns to verify</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{d.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        </div>
      )}

      {rules.length > 0 && (
        <div className="status-box" style={{ margin: "0 0 12px" }}>
          <b style={{ fontSize: 13.5 }}>Form rules (checked exactly, same as stage 1)</b>
          {rules.map((r) => (
            <span key={r.criterion_id} style={{ fontSize: 13.5 }}>
              <span className={`chip ${r.decision === "pass" ? "good" : r.decision === "fail" ? "bad" : "warn"}`}>
                {r.decision === "pass" ? "Met" : r.decision === "fail" ? "Not met" : "Needs a look"}
              </span>{" "}
              {r.name} — <span className="muted">{r.evidence}</span>
            </span>
          ))}
        </div>
      )}

      {[...hard, ...soft].map((r) => {
        const [dl, dk] = DECISION_LABEL[r.decision] ?? [r.decision, "neutral"];
        const [, ck] = confLevel(Number(r.confidence), threshold);
        return (
          <div className="ev" key={r.criterion_id}>
            <div className="h">
              <b>{r.name}{r.kind === "soft" && totalW ? <span className="mono muted" style={{ fontWeight: 400 }}> · {Math.round((r.weight / totalW) * 100)}%</span> : r.kind === "hard" ? <span className="muted" style={{ fontWeight: 400 }}> · hard filter</span> : null}</b>
              <span className={`chip ${dk}`}>{dl}</span>
            </div>
            <q>{r.evidence}</q>
            <div className="h">
              <span className="meta">{r.sources.length ? `From: ${r.sources.map((s) => SOURCE_LABEL[s]).join(", ")}` : "No source cited"}</span>
              <span className="confbar"><i style={{ ["--w" as string]: `${Math.round(Number(r.confidence) * 100)}%`, ["--c" as string]: `var(--${ck})` }} />{Number(r.confidence).toFixed(2)}</span>
            </div>
          </div>
        );
      })}

      {d.interview_questions.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Suggested interview questions</h3>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, display: "grid", gap: 4 }}>{d.interview_questions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </>
      )}

      {d.source_snapshot?.cv_summary && (
        <details className="raw" style={{ marginTop: 14 }}>
          <summary>What the AI read in the CV</summary>
          <p style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{d.source_snapshot.cv_summary}</p>
        </details>
      )}
      <p className="hint">
        Evaluated {d.finished_at ? new Date(d.finished_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""} by {providerLabel(d.provider)}{d.model ? ` (${d.model})` : ""}. Suitability uses the same weights as stage 1; hard filters still disqualify.
      </p>
    </div>
  );
}
