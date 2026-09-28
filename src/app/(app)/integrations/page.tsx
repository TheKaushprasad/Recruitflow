import { requireUser } from "@/lib/supabase/server";
import { activeModel, activeProvider } from "@/lib/ai/provider";
import { monthStart } from "@/lib/ai/usage";
import { budgetFor } from "@/lib/budget";
import { BudgetForm } from "./BudgetForm";
import { DisconnectGoogle } from "./DisconnectGoogle";

const PURPOSE: Record<string, string> = {
  stage1: "Stage 1 screening",
  stage1_explain: "Stage 1 explanations",
  stage2: "Stage 2 CV reviews",
  rubric: "Rubric drafting",
};
const usd = (n: number) => (n > 0 && n < 0.01 ? "< $0.01" : `$${n.toFixed(2)}`);

interface UsageRow { purpose: string; provider: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number | null; estimated: boolean }

const MESSAGES: Record<string, [string, "ok" | "bad"]> = {
  guest: ["Connecting Google isn't available in the demo. Create a free account to use your own Forms, Gmail and Calendar.", "bad"],
  connected: ["Google connected. Forms, Sheets, Gmail and Calendar are ready.", "ok"],
  denied: ["You declined access on Google's screen, so nothing was connected.", "bad"],
  state: ["The connection request expired or didn't match. Try connecting again.", "bad"],
  error: ["Google didn't finish connecting. Try again; if it keeps failing, check the OAuth client settings in Google Cloud.", "bad"],
};

const SERVICES = [
  ["Google Forms", "Creates and updates the application form you build in Job setup, and reads its responses.", "forms.body · forms.responses.readonly"],
  ["Google Sheets", "Reads the response Sheet of a form you link, and writes ranked results to a new tab.", "spreadsheets"],
  ["Gmail", "Sends candidate emails from your own inbox, only when you confirm.", "gmail.send"],
  ["Google Calendar", "Checks your free time and sends interview invites with a Meet link.", "calendar.events · calendar.freebusy"],
] as const;

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  const sp = await searchParams;
  const { supabase, user } = await requireUser();
  const [{ data: conn }, { data: usageRows }, budget] = await Promise.all([
    supabase.from("google_connection_status").select("*").maybeSingle(),
    supabase.rpc("ai_usage_summary", { p_since: monthStart() }),
    budgetFor(supabase, user.id),
  ]);
  const usage = ((usageRows ?? []) as UsageRow[]).map((r) => ({ ...r, calls: Number(r.calls), cost: Number(r.cost_usd ?? 0) }));
  const byPurpose = Object.entries(PURPOSE)
    .map(([k, label]) => ({ label, rows: usage.filter((r) => r.purpose === k) }))
    .filter((p) => p.rows.length);
  const unpriced = usage.filter((r) => r.cost_usd == null).map((r) => r.model);
  const month = new Date(monthStart()).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const pct = budget.budget ? Math.min(100, Math.round((budget.spent / budget.budget) * 100)) : 0;
  const msg = typeof sp.google === "string" ? MESSAGES[sp.google] : undefined;
  const jev = Boolean(process.env.TYPESAFE_API_KEY);
  const ai = activeProvider();

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Integrations</p>
          <h2>Connected once, used by every job</h2>
          <p>Your Google account is a one-time connection. reqroot asks only for what the workflow needs, and never for Google Drive.</p>
        </div>
      </div>
      {msg && <div className={`banner ${msg[1] === "ok" ? "ok" : ""}`} style={msg[1] === "bad" ? { background: "var(--bad-soft)" } : undefined}><div className="txt">{msg[0]}</div></div>}

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-head" style={{ marginBottom: 0, alignItems: "center" }}>
          <div>
            <h3>Google account</h3>
            <p style={{ fontSize: 14 }}>{conn ? <>Connected as <b>{conn.google_email}</b></> : "Not connected"}</p>
          </div>
          {conn ? <DisconnectGoogle /> : user.isGuest
            ? <span className="chip neutral" title="Guest workspaces can't connect Google">Not available in the demo</span>
            : <a className="pillbtn btn-lime" href="/auth/google/connect" style={{ textDecoration: "none" }}>Connect Google</a>}
        </div>
      </div>

      <div className="int-grid">
        {SERVICES.map(([name, desc, scope]) => (
          <div className="int" key={name}>
            <div className="hd"><h3>{name}</h3><span className={`chip ${conn ? "good" : "neutral"}`}>{conn ? "Connected" : "Not connected"}</span></div>
            <p>{desc}</p>
            <div><code>{scope}</code></div>
          </div>
        ))}
        <div className="int">
          <div className="hd"><h3>Jev (TypeSafe AI)</h3><span className={`chip ${jev ? "good" : "warn"}`}>{jev ? "Configured" : "Not configured"}</span></div>
          <p>Stage 1: judges AI-checked filters and scored criteria on form answers, with a calibrated confidence. {jev ? "" : "Without it, OpenAI judges everything instead (slower and more expensive)."}</p>
          <div><code>TYPESAFE_API_KEY</code></div>
        </div>
        <div className="int">
          <div className="hd"><h3>OpenAI</h3><span className={`chip ${ai ? "good" : "bad"}`}>{ai ? "Configured" : "Missing"}</span></div>
          <p>Drafts both stages of the rubric, decides the stage-1 items Jev is unsure about, and runs the stage-2 CV, portfolio and GitHub review.</p>
          <div><code>{`OPENAI_API_KEY · ${activeModel("main")}${activeModel("screen") !== activeModel("main") ? ` (stage 1: ${activeModel("screen")})` : ""}`}</code></div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 28 }}>
        <div className="section-head" style={{ marginBottom: 14 }}>
          <div>
            <h3>AI usage · {month}</h3>
            <p style={{ fontSize: 14 }}>
              <b className="mono" style={{ fontSize: 22, color: "var(--ink)" }}>{usd(budget.spent)}</b>
              {budget.budget != null ? <> of your <b>${budget.budget.toFixed(2)}</b> monthly budget</> : " spent this month · no budget set"}
            </p>
          </div>
          <BudgetForm budget={budget.budget} />
        </div>
        {budget.budget != null && (
          <div className="progress" style={{ marginBottom: 14 }}><i style={{ width: `${pct}%`, background: budget.over ? "var(--bad)" : pct > 80 ? "var(--warn)" : "var(--green)" }} /></div>
        )}
        {budget.over && (
          <div className="banner" style={{ background: "var(--bad-soft)" }}>
            <div className="txt"><b>Budget reached — AI scoring is paused.</b> New applications are still collected and filters still run; AI scoring and CV reviews resume next month or when you raise the budget.</div>
          </div>
        )}
        {byPurpose.length ? (
          <div className="tablewrap" style={{ border: 0 }}>
            <table style={{ minWidth: 560 }}>
              <thead><tr><th>Used for</th><th>Model</th><th>Calls</th><th>Tokens in / out</th><th style={{ textAlign: "right" }}>Cost</th></tr></thead>
              <tbody>
                {byPurpose.flatMap((p) => p.rows.map((r, i) => (
                  <tr key={`${r.purpose}-${r.provider}-${r.model}`} style={{ cursor: "default" }}>
                    <td>{i === 0 ? <b>{p.label}</b> : null}</td>
                    <td className="mono" style={{ fontSize: 13 }}>{r.provider === "jev" ? `Jev (${r.model})` : r.model}</td>
                    <td className="mono">{r.calls.toLocaleString("en-IN")}</td>
                    <td className="mono muted" style={{ fontSize: 13 }}>{Number(r.input_tokens).toLocaleString("en-IN")} / {Number(r.output_tokens).toLocaleString("en-IN")}{r.estimated ? " (est.)" : ""}</td>
                    <td className="mono" style={{ textAlign: "right" }}>{r.cost_usd == null ? "—" : usd(r.cost)}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        ) : <p className="hint">No AI calls yet this month.</p>}
        <p className="hint" style={{ marginTop: 10 }}>
          Costs are calculated from the tokens each call used and list prices, so they can differ slightly from your OpenAI and TypeSafe invoices. Jev token counts are estimated when it doesn&apos;t report them.
          {unpriced.length ? ` No list price known for ${[...new Set(unpriced)].join(", ")}, so it isn't counted toward the budget.` : ""}
        </p>
      </div>

      <h3 style={{ margin: "40px 0 12px" }}>How an application moves through reqroot</h3>
      <div className="flow">
        <div><b>New response</b><span>Forms API or linked Sheet</span></div>
        <div><b>Stage 1 filters</b><span>Exact checks, AI check for free text</span></div>
        <div><b>Stage 1 score</b><span>Jev; OpenAI only where Jev is unsure</span></div>
        <div><b>You move them on</b><span>Move to stage 2</span></div>
        <div><b>Stage 2 review</b><span>OpenAI · CV, portfolio, GitHub</span></div>
      </div>
    </>
  );
}
