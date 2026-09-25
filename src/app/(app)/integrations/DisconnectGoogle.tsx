"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAction } from "@/components/Toast";
import { disconnectGoogle } from "@/app/actions/integrations";

export function DisconnectGoogle() {
  const router = useRouter();
  const { run, pending } = useAction();
  const [confirm, setConfirm] = useState(false);
  return confirm ? (
    <div className="row">
      <span className="hint" style={{ margin: 0 }}>Syncing, emails and invites stop until you reconnect.</span>
      <button className="pillbtn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Keep</button>
      <button className="pillbtn btn-danger btn-sm" disabled={pending} onClick={async () => { await run(disconnectGoogle); router.refresh(); }}>Disconnect</button>
    </div>
  ) : (
    <button className="pillbtn btn-ghost btn-sm" onClick={() => setConfirm(true)}>Disconnect</button>
  );
}
