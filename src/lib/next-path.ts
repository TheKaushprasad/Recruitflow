/**
 * A same-site path to return to after signing in, or null. Rejects anything that could leave
 * the site ("//evil.com", "https://…", "/\evil.com") so ?next= can't be used as an open redirect.
 */
export function safeNext(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  if (!v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\r\n]/.test(v)) return null;
  return v.length > 500 ? null : v;
}
