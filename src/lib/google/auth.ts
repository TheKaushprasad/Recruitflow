import "server-only";
import { google } from "googleapis";
import { env } from "../env";
import { decrypt, encrypt } from "../crypto";
import { createAdminClient } from "../supabase/admin";

// One-time connection per recruiter. Scopes are the minimum the workflow needs.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/forms.body", // create/update in-app forms
  "https://www.googleapis.com/auth/forms.responses.readonly", // read in-app form responses
  "https://www.googleapis.com/auth/spreadsheets", // read linked Sheet, export results
  "https://www.googleapis.com/auth/gmail.send", // send from the recruiter's inbox
  "https://www.googleapis.com/auth/calendar.events", // interview invites
  "https://www.googleapis.com/auth/calendar.freebusy", // show free slots
];

export function oauthClient() {
  return new google.auth.OAuth2(
    env.googleClientId(),
    env.googleClientSecret(),
    `${env.appUrl()}/auth/google/callback`,
  );
}

export function consentUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function saveConnection(recruiterId: string, code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Remove reqroot at myaccount.google.com/permissions and connect again.",
    );
  }
  client.setCredentials(tokens);
  const info = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const admin = createAdminClient();
  const { error } = await admin.from("google_connections").upsert({
    recruiter_id: recruiterId,
    google_email: info.data.email ?? null,
    refresh_token_enc: encrypt(tokens.refresh_token),
    scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super("Your Google account isn't connected. Connect it under Integrations.");
  }
}

/** Authorized OAuth2 client for a recruiter, or throws GoogleNotConnectedError. */
export async function googleFor(recruiterId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_connections")
    .select("refresh_token_enc, google_email")
    .eq("recruiter_id", recruiterId)
    .maybeSingle();
  if (!data) throw new GoogleNotConnectedError();
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(data.refresh_token_enc) });
  return { auth: client, email: data.google_email as string | null };
}

export async function disconnect(recruiterId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("google_connections")
    .select("refresh_token_enc")
    .eq("recruiter_id", recruiterId)
    .maybeSingle();
  if (data) {
    try {
      await oauthClient().revokeToken(decrypt(data.refresh_token_enc));
    } catch {
      // Already revoked on Google's side; delete our copy regardless.
    }
  }
  await admin.from("google_connections").delete().eq("recruiter_id", recruiterId);
}
