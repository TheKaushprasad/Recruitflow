import "server-only";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { RawResponse } from "./forms";

/** Accepts a full Sheets URL or a bare spreadsheet id. */
export function parseSheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const t = input.trim();
  return /^[a-zA-Z0-9_-]{25,}$/.test(t) ? t : null;
}

/** Accepts a full Forms edit URL or a bare form id. */
export function parseFormId(input: string): string | null {
  const m = input.match(/\/forms\/d\/(?!e\/)([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  const t = input.trim();
  return /^[a-zA-Z0-9_-]{25,}$/.test(t) ? t : null;
}

function safeDate(v: string) {
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Rows of a Form-linked response sheet. Row 1 is the header. */
export async function readResponseRows(
  auth: OAuth2Client,
  sheetId: string,
  range = "A:ZZ",
): Promise<RawResponse[]> {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  const [header, ...rows] = (res.data.values ?? []) as string[][];
  if (!header) return [];
  const tsCol = header.findIndex((h) => /timestamp/i.test(h));
  return rows
    .map((row, i) => ({ row, n: i + 2 }))
    .filter(({ row }) => row.some((c) => String(c ?? "").trim()))
    .map(({ row, n }) => ({
      externalId: `row:${n}`,
      submittedAt: tsCol >= 0 && row[tsCol] ? safeDate(row[tsCol]) : null,
      email: null,
      answers: header
        .map((h, i) => ({ question: String(h ?? ""), answer: String(row[i] ?? "").trim(), i }))
        .filter((a) => a.i !== tsCol && a.question)
        .map(({ question, answer }) => ({ question, answer })),
    }));
}

/** Writes rows to a tab named `tabTitle`, creating or clearing it first. */
export async function writeResultsTab(
  auth: OAuth2Client,
  sheetId: string,
  tabTitle: string,
  rows: (string | number)[][],
) {
  const sheets = google.sheets({ version: "v4", auth });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties.title" });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tabTitle);
  if (exists) {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: `'${tabTitle}'` });
  } else {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabTitle } } }] },
    });
  }
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${tabTitle}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

export async function createSpreadsheet(auth: OAuth2Client, title: string) {
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.create({ requestBody: { properties: { title } } });
  return res.data.spreadsheetId!;
}
