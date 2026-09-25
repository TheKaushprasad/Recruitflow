import "server-only";
import { randomUUID } from "node:crypto";
import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export async function busyTimes(auth: OAuth2Client, from: Date, to: Date) {
  const cal = google.calendar({ version: "v3", auth });
  const res = await cal.freebusy.query({
    requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
  });
  return (res.data.calendars?.primary?.busy ?? []).map((b) => ({ start: b.start!, end: b.end! }));
}

export async function createInterviewEvent(
  auth: OAuth2Client,
  opts: { summary: string; description: string; start: Date; durationMin: number; attendees: string[] },
) {
  const cal = google.calendar({ version: "v3", auth });
  const end = new Date(opts.start.getTime() + opts.durationMin * 60_000);
  const res = await cal.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: opts.attendees.map((email) => ({ email })),
      conferenceData: {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    },
  });
  return { id: res.data.id ?? null, meetUrl: res.data.hangoutLink ?? null, htmlLink: res.data.htmlLink ?? null };
}

export async function deleteEvent(auth: OAuth2Client, eventId: string) {
  const cal = google.calendar({ version: "v3", auth });
  await cal.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
}
