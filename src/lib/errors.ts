/**
 * Readable message from anything thrown or returned as an error:
 * Error instances, Supabase/PostgREST errors ({ message, details, hint, code }), or strings.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    if (typeof o.message === "string" && o.message) {
      const extra = [o.details, o.hint].filter((x) => typeof x === "string" && x).join(" ");
      return extra ? `${o.message} (${extra})` : o.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return "Something went wrong.";
}
