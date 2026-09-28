import { redirect } from "next/navigation";
import { safeNext } from "@/lib/next-path";

// Sign-in now happens in a dialog on the home page; keep old /login links working.
export default async function Login({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const q = new URLSearchParams({ signin: "1" });
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (next) q.set("next", next);
  if (typeof sp.error === "string") q.set("error", sp.error);
  redirect(`/?${q}`);
}
