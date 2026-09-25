function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  googleClientId: () => required("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => required("GOOGLE_CLIENT_SECRET"),
  tokenKey: () => required("TOKEN_ENCRYPTION_KEY"),
  cronSecret: () => required("CRON_SECRET"),
  claudeModel: () => process.env.CLAUDE_MODEL ?? "claude-opus-5",
  jevConfigured: () => Boolean(process.env.TYPESAFE_API_KEY),
};
