import { requireUser } from "@/lib/supabase/server";
import { activeModel, activeProvider, PROVIDER_LABEL } from "@/lib/ai/provider";
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
  const aiName = ai ? PROVIDER_LABEL[ai] : "AI";

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
          <p>Scores every criterion with a calibrated confidence. {jev ? "" : `Without it, ${aiName} scores every criterion instead (slower and more expensive).`}</p>
          <div><code>TYPESAFE_API_KEY</code></div>
        </div>
        <div className="int">
          <div className="hd"><h3>AI reviewer</h3><span className={`chip ${ai ? "good" : "bad"}`}>{ai ? `${aiName} · configured` : "Missing"}</span></div>
          <p>Drafts rubrics, rechecks low-confidence scores and writes the evidence for every decision. Choose it with AI_PROVIDER (openai or claude).</p>
          <div><code>{ai ? `${ai === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} · ${activeModel(ai)}` : "OPENAI_API_KEY or ANTHROPIC_API_KEY"}</code></div>
        </div>
      </div>

      <h3 style={{ margin: "40px 0 12px" }}>How a response becomes a ranked candidate</h3>
      <div className="flow">
        <div><b>New response</b><span>Forms API or linked Sheet, polled</span></div>
        <div><b>Score each criterion</b><span>Jev · decision + confidence</span></div>
        <div><b>Recheck if low</b><span>{aiName} · with evidence</span></div>
        <div><b>Aggregate &amp; store</b><span>Supabase · your rows only</span></div>
        <div><b>Ranked table</b><span>Updates live</span></div>
      </div>
    </>
  );
}
