import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// RFC 2047 encoding for non-ASCII subjects
function encodeHeader(v: string) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export async function sendEmail(auth: OAuth2Client, opts: { to: string; subject: string; body: string }) {
  if (/[\r\n,;]/.test(opts.to) || !opts.to.includes("@")) throw new Error(`Invalid recipient address: ${opts.to}`);
  const mime = [
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.body, "utf8").toString("base64"),
  ].join("\r\n");
  const gmail = google.gmail({ version: "v1", auth });
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(mime).toString("base64url") },
  });
  return res.data.id ?? null;
}
