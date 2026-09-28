"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/next-path";
import { DemoButton } from "./DemoButton";
import { Icon } from "./Icon";

const ERRORS: Record<string, string> = {
  link: "That sign-in link has expired or was already used. Send yourself a new one.",
  provider: "Google sign-in didn't finish. Please try again.",
};

/** Sign in on the home page: opens for /?signin=1 (optionally &next=/somewhere&error=link). */
export function SignInDialog() {
  const router = useRouter();
  const sp = useSearchParams();
  const open = sp.get("signin") === "1";
  const next = safeNext(sp.get("next"));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const urlError = ERRORS[sp.get("error") ?? ""] ?? "";

  const close = () => {
    setState("idle");
    setError("");
    router.replace("/", { scroll: false });
  };

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  });

  if (!open) return null;

  const callback = () => {
    const u = new URL("/auth/callback", window.location.origin);
    if (next) u.searchParams.set("next", next);
    return u.toString();
  };

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: callback() } });
    if (error) {
      setError(/rate limit/i.test(error.message) ? "Too many sign-in emails right now. Please wait a few minutes, or continue with Google." : error.message);
      setState("idle");
    } else setState("sent");
  }

  async function google() {
    setError("");
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
    if (error) setError(error.message);
  }

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal signin" role="dialog" aria-modal="true" aria-labelledby="signin-h">
        <div className="dhead">
          <div>
            <span className="logo" style={{ fontSize: 17 }}>req<span>root</span></span>
            <h2 id="signin-h" style={{ margin: "10px 0 4px" }}>{state === "sent" ? "Check your inbox" : "Sign in to reqroot"}</h2>
            <p className="hint" style={{ margin: 0 }}>
              {state === "sent"
                ? <>We sent a sign-in link to <b>{email}</b>. It expires in an hour — you can close this window.</>
                : "Set up jobs, screen applicants and make fair, explainable hiring decisions."}
            </p>
          </div>
          <button className="iconbtn" aria-label="Close" onClick={close}><Icon name="x" /></button>
        </div>

        {state !== "sent" && (
          <>
            {(error || urlError) && <div className="banner" style={{ background: "var(--bad-soft)", margin: "0 0 14px" }}><div className="txt">{error || urlError}</div></div>}
            <form onSubmit={sendLink} style={{ display: "grid", gap: 10 }}>
              <label className="f" htmlFor="signin-email" style={{ margin: 0 }}>Work email</label>
              <input ref={input} id="signin-email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              <button className="pillbtn btn-lime" disabled={state === "sending"}>
                {state === "sending" ? <span className="spin" /> : "Continue with email →"}
              </button>
            </form>
            <div className="or"><span>or</span></div>
            <button className="pillbtn btn-ghost signin-google" type="button" onClick={google}>
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </button>
          </>
        )}

        <div className="signin-foot">
          <span className="muted">New to reqroot?</span>
          <DemoButton label="Try the live demo — no sign-up" className="btn-link" />
        </div>
        <p className="hint" style={{ margin: "10px 0 0", textAlign: "center" }}>
          By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
