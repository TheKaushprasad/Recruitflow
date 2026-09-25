"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAction } from "@/components/Toast";
import { deleteTemplate, saveTemplate } from "@/app/actions/email";
import { PLACEHOLDERS, fillTemplate } from "@/lib/placeholders";
import type { EmailTemplate } from "@/lib/types";

const SAMPLE = { first_name: "Priya", full_name: "Priya Nair", job_title: "Senior Frontend Engineer", stage: "Technical", status: "Technical", recruiter_name: "You" };

export function TemplateEditor({ templates }: { templates: EmailTemplate[] }) {
  const router = useRouter();
  const { run, pending } = useAction();
  const [selId, setSelId] = useState<string | null>(templates[0]?.id ?? null);
  const sel = templates.find((t) => t.id === selId);
  const [form, setForm] = useState({ name: sel?.name ?? "", subject: sel?.subject ?? "", body: sel?.body ?? "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lastField = useRef<"subject" | "body">("body");
  const subjRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const pick = (t: EmailTemplate | null) => {
    setSelId(t?.id ?? null);
    setForm(t ? { name: t.name, subject: t.subject, body: t.body } : { name: "Untitled template", subject: "{{job_title}}", body: "Hi {{first_name}},\n\n" });
    setConfirmDelete(false);
  };

  const insert = (token: string) => {
    const el = lastField.current === "subject" ? subjRef.current : bodyRef.current;
    if (!el) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    const v = el.value.slice(0, s) + token + el.value.slice(e);
    setForm((f) => ({ ...f, [lastField.current]: v }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };

  return (
    <>
      <div className="section-head">
        <div>
          <p className="eyebrow" style={{ margin: "0 0 8px" }}>Candidate emails</p>
          <h2>Templates, sent from your Gmail</h2>
          <p>Nothing sends automatically. You pick candidates on the shortlist or a pipeline card, review the preview, then confirm.</p>
        </div>
        <button className="pillbtn btn-dark btn-sm" onClick={() => pick(null)}>+ New template</button>
      </div>
      <div className="email-grid">
        <div className="tpl-list">
          {templates.map((t) => (
            <button key={t.id} aria-current={t.id === selId} onClick={() => pick(t)}><b>{t.name}</b><span>{t.subject}</span></button>
          ))}
          {!selId && <button aria-current><b>{form.name || "New template"}</b><span>Unsaved</span></button>}
        </div>
        <div className="grid2" style={{ gap: 20 }}>
          <div className="panel">
            <div className="field"><label className="f" htmlFor="tn">Template name</label><input type="text" id="tn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label className="f" htmlFor="tsub">Subject</label><input ref={subjRef} type="text" id="tsub" value={form.subject} onFocus={() => (lastField.current = "subject")} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}>
              <label className="f" htmlFor="tbody">Body</label>
              <textarea ref={bodyRef} id="tbody" rows={12} value={form.body} onFocus={() => (lastField.current = "body")} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <div className="ph">{PLACEHOLDERS.map((p) => <button key={p} type="button" onClick={() => insert(`{{${p}}}`)}>{`{{${p}}}`}</button>)}</div>
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button className="pillbtn btn-lime btn-sm" disabled={pending} onClick={async () => {
                const r = await run(() => saveTemplate({ ...form, id: selId ?? undefined }));
                if (r.ok && "id" in r && r.id) setSelId(r.id);
                router.refresh();
              }}>Save template</button>
              {selId && (confirmDelete
                ? <button className="pillbtn btn-danger btn-sm" disabled={pending} onClick={async () => { await run(() => deleteTemplate(selId)); pick(templates.find((t) => t.id !== selId) ?? null); router.refresh(); }}>Confirm delete</button>
                : <button className="pillbtn btn-ghost btn-sm" onClick={() => setConfirmDelete(true)}>Delete</button>)}
            </div>
          </div>
          <div>
            <p className="hint" style={{ margin: "0 0 8px" }}>Preview with sample values</p>
            <div className="preview"><div className="subj">{fillTemplate(form.subject, SAMPLE)}</div>{fillTemplate(form.body, SAMPLE)}</div>
          </div>
        </div>
      </div>
    </>
  );
}
