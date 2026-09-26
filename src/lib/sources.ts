import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { directCvUrl, githubUser, normalizeUrl } from "./urls";

// Reads the candidate-supplied links for stage-2 evaluation: CV, portfolio site, GitHub.
// All URLs come from applicants, so fetching is defensive: public http(s) hosts only,
// no private/loopback addresses (checked on every redirect), size caps and timeouts.

export type SourceKind = "cv" | "portfolio" | "github";
export type SourceStatus = "read" | "failed" | "missing";

export interface SourceResult {
  kind: SourceKind;
  url: string | null;
  status: SourceStatus;
  note: string;
}

const UA = "recruitflow/1.0 (candidate screening; +https://github.com/TheKaushprasad/Recruitflow)";
const TIMEOUT_MS = 20_000;

function isPrivateIp(ip: string) {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
    return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function assertPublicUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid link.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) links can be read.");
  if (u.username || u.password) throw new Error("Links with embedded credentials aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("That host isn't public.");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(isPrivateIp)) throw new Error("That host isn't public.");
  return u;
}

/** GET with manual redirects (each hop re-checked), a timeout and a byte cap. */
async function safeGet(url: string, opts: { maxBytes: number; headers?: Record<string, string> }) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const u = await assertPublicUrl(current);
    const res = await fetch(u, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`The link returned HTTP ${res.status}.`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > opts.maxBytes) throw new Error(`The file is too large (${Math.round(len / 1e6)} MB).`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > opts.maxBytes) {
          await reader.cancel();
          throw new Error(`The file is too large (over ${Math.round(opts.maxBytes / 1e6)} MB).`);
        }
        chunks.push(value);
      }
    }
    return { buf: Buffer.concat(chunks), contentType: res.headers.get("content-type") ?? "", finalUrl: current };
  }
  throw new Error("Too many redirects.");
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ---------------- CV ----------------

export interface CvRead extends SourceResult {
  pdfBase64?: string;
  text?: string;
}

export async function readCv(input: string | null): Promise<CvRead> {
  const url = normalizeUrl(input);
  if (!url) return { kind: "cv", url: input ?? null, status: "missing", note: input ? "Not a valid link." : "No CV link." };
  try {
    const { buf, contentType } = await safeGet(directCvUrl(url), { maxBytes: 12_000_000 });
    const head = buf.subarray(0, 5).toString("latin1");
    if (head.startsWith("%PDF")) {
      return { kind: "cv", url, status: "read", note: `PDF, ${Math.max(1, Math.round(buf.length / 1024))} KB`, pdfBase64: buf.toString("base64") };
    }
    if (head.startsWith("PK")) {
      return { kind: "cv", url, status: "failed", note: "It's a Word/zip file. Ask the candidate for a PDF, or a Google Docs link." };
    }
    const text = buf.toString("utf8");
    if (/html/i.test(contentType) || /<html/i.test(text.slice(0, 500))) {
      if (/accounts\.google\.com|ServiceLogin|You need access|Request access/i.test(text)) {
        return { kind: "cv", url, status: "failed", note: "The file isn't shared publicly. The candidate needs to set sharing to “Anyone with the link”." };
      }
      if (/drive\.google\.com/.test(url) && /virus scan|too large to scan/i.test(text)) {
        return { kind: "cv", url, status: "failed", note: "Google Drive blocked the download (file too large to scan)." };
      }
      const plain = htmlToText(text);
      if (plain.length < 300) return { kind: "cv", url, status: "failed", note: "The link opened a web page, not a CV file." };
      return { kind: "cv", url, status: "read", note: "Web page (text extracted)", text: plain.slice(0, 20_000) };
    }
    if (/text\/plain/i.test(contentType)) {
      return { kind: "cv", url, status: "read", note: "Plain text", text: text.slice(0, 20_000) };
    }
    return { kind: "cv", url, status: "failed", note: `Unsupported file type (${contentType || "unknown"}). A PDF works best.` };
  } catch (e) {
    return { kind: "cv", url, status: "failed", note: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------- portfolio ----------------

export interface TextRead extends SourceResult {
  text?: string;
}

export async function readPortfolio(input: string | null): Promise<TextRead> {
  const url = normalizeUrl(input);
  if (!url) return { kind: "portfolio", url: input ?? null, status: "missing", note: input ? "Not a valid link." : "No portfolio link." };
  try {
    const { buf, contentType } = await safeGet(url, { maxBytes: 3_000_000, headers: { Accept: "text/html,text/plain" } });
    if (!/html|text/i.test(contentType)) return { kind: "portfolio", url, status: "failed", note: `Not a web page (${contentType}).` };
    const raw = buf.toString("utf8");
    const title = raw.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    const text = htmlToText(raw);
    if (text.length < 120) {
      return { kind: "portfolio", url, status: "failed", note: "The page has almost no readable text (it may need JavaScript to load)." };
    }
    return {
      kind: "portfolio", url, status: "read",
      note: `${title ? `“${title.slice(0, 80)}”, ` : ""}${text.length.toLocaleString()} characters read`,
      text: text.slice(0, 15_000),
    };
  } catch (e) {
    return { kind: "portfolio", url, status: "failed", note: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------- GitHub ----------------

async function gh<T>(path: string, raw = false): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) throw new Error("GitHub user or repository not found.");
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit reached. Add a GITHUB_TOKEN to raise it.");
  if (!res.ok) throw new Error(`GitHub returned HTTP ${res.status}.`);
  return (raw ? res.text() : res.json()) as Promise<T>;
}

interface GhRepo {
  name: string; description: string | null; language: string | null; stargazers_count: number; forks_count: number;
  fork: boolean; archived: boolean; pushed_at: string; topics?: string[]; html_url: string;
}

export async function readGitHub(input: string | null): Promise<TextRead> {
  const url = normalizeUrl(input, "github");
  if (!url) return { kind: "github", url: input ?? null, status: "missing", note: input ? "Not a valid link." : "No GitHub link." };
  const gu = githubUser(url);
  if (!gu) return { kind: "github", url, status: "failed", note: "Not a GitHub profile link." };
  const { user, repo: repoName } = gu;
  try {
    const profile = await gh<{ login: string; name: string | null; bio: string | null; public_repos: number; followers: number; created_at: string; blog: string | null }>(`/users/${user}`);
    const repos = await gh<GhRepo[]>(`/users/${user}/repos?per_page=100&sort=pushed`);
    const own = repos.filter((r) => !r.fork && !r.archived);
    const byStars = [...own].sort((a, b) => b.stargazers_count - a.stargazers_count);
    const pinned = repoName ? own.find((r) => r.name.toLowerCase() === repoName.toLowerCase()) : undefined;
    const pick = [...new Set([pinned, ...byStars.slice(0, 5), ...own.slice(0, 5)].filter(Boolean) as GhRepo[])].slice(0, 8);
    const langs = new Map<string, number>();
    own.forEach((r) => r.language && langs.set(r.language, (langs.get(r.language) ?? 0) + 1));

    const readmes: string[] = [];
    for (const r of pick.slice(0, 3)) {
      try {
        const md = await gh<string>(`/repos/${user}/${r.name}/readme`, true);
        readmes.push(`### README: ${r.name}\n${md.slice(0, 2500)}`);
      } catch {
        /* repo without README */
      }
    }

    const text = [
      `GitHub: ${profile.login}${profile.name ? ` (${profile.name})` : ""}`,
      profile.bio ? `Bio: ${profile.bio}` : "",
      `Account since ${profile.created_at.slice(0, 4)} · ${profile.public_repos} public repos · ${profile.followers} followers`,
      `Own (non-fork) repos: ${own.length}. Languages: ${[...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l, n]) => `${l} (${n})`).join(", ") || "n/a"}`,
      "",
      "Notable repositories:",
      ...pick.map((r) => `- ${r.name} [${r.language ?? "n/a"}] ★${r.stargazers_count} forks ${r.forks_count}, last push ${r.pushed_at.slice(0, 10)}${r.topics?.length ? `, topics: ${r.topics.join(", ")}` : ""}${r.description ? ` — ${r.description}` : ""}`),
      "",
      ...readmes,
    ].filter((l) => l !== undefined).join("\n");

    return {
      kind: "github", url, status: "read",
      note: `${own.length} own repos, ${pick.length} reviewed${readmes.length ? `, ${readmes.length} READMEs` : ""}`,
      text: text.slice(0, 15_000),
    };
  } catch (e) {
    return { kind: "github", url, status: "failed", note: e instanceof Error ? e.message : String(e) };
  }
}
