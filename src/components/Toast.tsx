"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastCtx = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const toast = useCallback((m: string) => {
    setMsg(m);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), Math.min(9000, 2800 + m.length * 30));
  }, []);
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={`toast${show ? " show" : ""}`} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Runs a server action returning {ok, message|error} and toasts the outcome. */
export function useAction() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = useCallback(
    async <T extends { ok: boolean; message?: string; error?: string }>(fn: () => Promise<T>) => {
      setPending(true);
      try {
        const r = await fn();
        if (!r.ok) toast(r.error ?? "Something went wrong.");
        else if (r.message) toast(r.message);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong.");
        return { ok: false } as T;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { run, pending };
}
