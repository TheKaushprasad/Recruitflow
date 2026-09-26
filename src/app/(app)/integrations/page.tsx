import { requireUser } from "@/lib/supabase/server";
import { activeModel, activeProvider } from "@/lib/ai/provider";
import { DisconnectGoogle } from "./DisconnectGoogle";

const MESSAGES: Record<string, [string, "ok" | "bad"]> = {
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
  const { supabase } = await requireUser();
  const { data: conn } = await supabase.from("google_connection_status").select("*").maybeSingle();
  const msg = typeof sp.google === "string" ? MESSAGES[sp.google] : undefined;
  const jev = Boolean(process.env.TYPESAFE_API_KEY);
  const ai = activeProvider();

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Integrations</p>
          <h2>Connected once, used by every job</h2>
          <p>Your Google account is a one-time connection. recruitflow asks only for what the workflow needs, and never for Google Drive.</p>
        </div>
      </div>
      {msg && <div className={`banner ${msg[1] === "ok" ? "ok" : ""}`} style={msg[1] === "bad" ? { background: "var(--bad-soft)" } : undefined}><div className="txt">{msg[0]}</div></div>}

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="section-head" style={{ marginBottom: 0, alignItems: "center" }}>
          <div>
            <h3>Google account</h3>
            <p style={{ fontSize: 14 }}>{conn ? <>Connected as <b>{conn.google_email}</b></> : "Not connected"}</p>
          </div>
          {conn ? <DisconnectGoogle /> : <a className="pillbtn btn-lime" href="/auth/google/connect" style={{ textDecoration: "none" }}>Connect Google</a>}
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
          <p>Drafts both stages of the rubric, rechecks low-confidence stage-1 decisions, and runs the stage-2 CV, portfolio and GitHub review.</p>
          <div><code>{`OPENAI_API_KEY · ${activeModel("main")}${activeModel("screen") !== activeModel("main") ? ` (stage 1: ${activeModel("screen")})` : ""}`}</code></div>
        </div>
      </div>

      <h3 style={{ margin: "40px 0 12px" }}>How an application moves through recruitflow</h3>
      <div className="flow">
        <div><b>New response</b><span>Forms API or linked Sheet</span></div>
        <div><b>Stage 1 filters</b><span>Exact checks, AI check for free text</span></div>
        <div><b>Stage 1 score</b><span>Jev, rechecked by OpenAI</span></div>
        <div><b>You move them on</b><span>Move to stage 2</span></div>
        <div><b>Stage 2 review</b><span>OpenAI · CV, portfolio, GitHub</span></div>
      </div>
    </>
  );
}
