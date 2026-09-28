"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { startDemo } from "@/app/actions/demo";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: { sitekey: string; callback: (t: string) => void; "expired-callback"?: () => void; theme?: string }) => string };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/**
 * Starts a guest demo workspace. With NEXT_PUBLIC_TURNSTILE_SITE_KEY set (and the matching secret
 * configured under Supabase → Authentication → Bot protection), a Cloudflare Turnstile check runs first.
 */
export function DemoButton({ label = "Try the live demo", className = "pillbtn btn-lime" }: { label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!SITE_KEY || !ready || !box.current || !window.turnstile || box.current.childElementCount) return;
    window.turnstile.render(box.current, { sitekey: SITE_KEY, callback: setToken, "expired-callback": () => setToken(null) });
  }, [ready]);

  async function go() {
    setBusy(true);
    setError("");
    try {
      // On success the server redirects into the demo job, so this only returns on failure.
      const r = await startDemo(token ?? undefined);
      if (r && !r.ok) { setError(r.error ?? "Couldn't start the demo."); setBusy(false); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the demo.");
      setBusy(false);
    }
  }

  return (
    <div className="demo-btn">
      {SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)} />}
      <button className={className} disabled={busy || (!!SITE_KEY && !token)} onClick={go}>
        {busy ? <><span className="spin" /> Building your demo…</> : label}
      </button>
      {SITE_KEY && <div ref={box} className="turnstile" />}
      {error && <p className="error-text" style={{ margin: "8px 0 0" }}>{error}</p>}
    </div>
  );
}
