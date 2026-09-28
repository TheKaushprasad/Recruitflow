import type { NextConfig } from "next";

// Build-time check: the NEXT_PUBLIC_* values are baked into the browser bundle while
// building, so they must exist in the build environment (e.g. Vercel project settings).
// Prints names only — never values.
const PUBLIC_AT_BUILD = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const SERVER_AT_RUNTIME = [
  "SUPABASE_SERVICE_ROLE_KEY", "APP_URL", "TOKEN_ENCRYPTION_KEY", "CRON_SECRET",
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "OPENAI_API_KEY", "OPENAI_MODEL", "TYPESAFE_API_KEY",
];
if (process.env.VERCEL || process.env.CI) {
  const status = (k: string) => `${k}=${process.env[k]?.trim() ? "set" : "MISSING"}`;
  console.log(`[reqroot] build env (${process.env.VERCEL_ENV ?? "unknown"}): ${PUBLIC_AT_BUILD.map(status).join(", ")}`);
  console.log(`[reqroot] runtime env: ${SERVER_AT_RUNTIME.map(status).join(", ")}`);
  // Shape of the OpenAI key only (never the key): catches quotes, stray spaces and cut-off pastes.
  const k = process.env.OPENAI_API_KEY ?? "";
  if (k) {
    console.log(
      `[reqroot] OPENAI_API_KEY shape: length ${k.length}, starts "sk-": ${k.startsWith("sk-")}, ` +
        `quotes: ${/^["']|["']$/.test(k)}, spaces/newlines: ${/\s/.test(k)}`,
    );
  }
  const missing = PUBLIC_AT_BUILD.filter((k) => !process.env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(" and ")} in this ${process.env.VERCEL_ENV ?? ""} build. ` +
        "Add them in Vercel → Settings → Environment Variables for this environment, then redeploy.",
    );
  }
}

const nextConfig: NextConfig = {};

export default nextConfig;
