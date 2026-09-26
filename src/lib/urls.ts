// Pure link helpers for candidate-supplied URLs (no network, safe anywhere).

/** Accepts "https://…", "www.…", "github.com/…" and, for GitHub, bare usernames. */
export function normalizeUrl(input: string | null | undefined, kind?: "cv" | "portfolio" | "github"): string | null {
  const v = (input ?? "").trim();
  if (!v) return null;
  if (kind === "github" && /^@?[a-z\d](?:[a-z\d-]{0,38})$/i.test(v)) return `https://github.com/${v.replace(/^@/, "")}`;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(v)) return `https://${v}`;
  return null;
}

/** Turns share links into direct downloads where the host supports it. */
export function directCvUrl(url: string) {
  const drive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{20,})/);
  if (drive) return `https://drive.google.com/uc?export=download&id=${drive[1]}`;
  const doc = url.match(/docs\.google\.com\/document\/d\/([\w-]{20,})/);
  if (doc) return `https://docs.google.com/document/d/${doc[1]}/export?format=pdf`;
  const u = new URL(url);
  if (u.hostname.endsWith("dropbox.com")) {
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return url;
}

/** GitHub username (and optional repo) from a profile or repo link. */
export function githubUser(url: string): { user: string; repo?: string } | null {
  const m = url.match(/github\.com\/([a-z\d](?:[a-z\d-]{0,38}))(?:\/([\w.-]+))?/i);
  if (!m) return null;
  const reserved = new Set(["orgs", "settings", "features", "topics", "about", "pricing", "login", "marketplace"]);
  if (reserved.has(m[1].toLowerCase())) return null;
  return { user: m[1], repo: m[2] };
}
