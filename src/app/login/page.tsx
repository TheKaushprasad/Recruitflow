"use client";

import { useState } from "react";
import Link from "next/link";
import { DemoButton } from "@/components/DemoButton";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const supabase = createClient();
  const redirectTo = typeof window === "undefined" ? undefined : `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    if (error) {
      setError(error.message);
      setState("idle");
    } else setState("sent");
  }

  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setError(error.message);
  }

  return (
    <div className="center-page">
      <div className="auth-card">
        <Link className="logo" href="/" style={{ marginBottom: 28, display: "inline-block" }}>
          req<span>root</span>
        </Link>
        <h1 className="hero" style={{ fontSize: 44 }}>Move the right people forward.</h1>
        {state === "sent" ? (
          <div className="panel">
            <h3>Check your inbox</h3>
            <p className="muted">We sent a sign-in link to {email}. It expires in an hour.</p>
          </div>
        ) : (
          <div className="panel" style={{ display: "grid", gap: 16 }}>
            <form onSubmit={sendLink}>
              <label className="f" htmlFor="email">Work email</label>
              <input id="email" type="text" inputMode="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              <button className="pillbtn btn-lime" style={{ width: "100%", marginTop: 12 }} disabled={state === "sending"}>
                {state === "sending" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
            <button className="pillbtn btn-ghost" onClick={google} type="button">Continue with Google</button>
            {error && <p className="error-text">{error}</p>}
          </div>
        )}
        <div className="login-demo">
          <span className="muted">Just looking?</span>
          <DemoButton label="Try the live demo — no sign-up" className="pillbtn btn-ghost btn-sm" />
        </div>
      </div>
    </div>
  );
}
