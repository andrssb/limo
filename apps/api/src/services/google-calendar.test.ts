import assert from "node:assert/strict";
import test from "node:test";
import {
  createGoogleCalendarMeeting,
  getGoogleCalendarAuthUrl,
  isGoogleCalendarSlotAvailable,
} from "./google-calendar.js";

test("OAuth do calendário pede acesso offline e usa state", () => {
  const url = new URL(getGoogleCalendarAuthUrl({
    clientId: "client-1",
    clientSecret: "secret",
    redirectUri: "https://api.example.com/callback",
  }, "state-1", "agenda@example.com"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("login_hint"), "agenda@example.com");
  assert.match(url.searchParams.get("scope") ?? "", /calendar\.events/);
});

test("freebusy reconhece horário livre", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({
    calendars: { primary: { busy: [] } },
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const available = await isGoogleCalendarSlotAvailable(
    "token", "primary", new Date("2026-09-15T14:00:00Z"),
    new Date("2026-09-15T14:30:00Z"), "America/Sao_Paulo", fakeFetch,
  );
  assert.equal(available, true);
});

test("criação de evento envia convite e solicita Google Meet", async () => {
  let requestBody: any;
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "event-1", htmlLink: "https://calendar/event", hangoutLink: "https://meet/link" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const event = await createGoogleCalendarMeeting({
    accessToken: "token",
    calendarId: "primary",
    summary: "Diagnóstico Limo",
    description: "Reunião",
    start: new Date("2026-09-15T14:00:00Z"),
    end: new Date("2026-09-15T14:30:00Z"),
    timezone: "America/Sao_Paulo",
    attendeeEmail: "lead@example.com",
    conferenceRequestId: "attempt-1",
  }, fakeFetch);
  assert.equal(event.meetLink, "https://meet/link");
  assert.equal(requestBody.attendees[0].email, "lead@example.com");
  assert.equal(requestBody.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
});
