export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

export interface GoogleCalendarEventInput {
  accessToken: string;
  calendarId: string;
  summary: string;
  description: string;
  start: Date;
  end: Date;
  timezone: string;
  attendeeEmail: string;
  conferenceRequestId: string;
}

export class GoogleCalendarError extends Error {
  constructor(message: string, readonly statusCode: number | null, readonly retryable: boolean) {
    super(message);
    this.name = "GoogleCalendarError";
  }
}

function googleError(payload: Record<string, unknown>, fallback: string): string {
  const error = payload.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export function getGoogleCalendarAuthUrl(config: GoogleOAuthConfig, state: string, loginHint: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    state,
    login_hint: loginHint,
  }).toString();
  return url.toString();
}

export async function exchangeGoogleCalendarCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new GoogleCalendarError(googleError(payload, "Falha ao trocar código OAuth"), response.status, false);
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    refreshToken: typeof payload.refresh_token === "string" ? payload.refresh_token : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: typeof payload.scope === "string" ? payload.scope : GOOGLE_CALENDAR_SCOPES.join(" "),
  };
}

export async function refreshGoogleCalendarToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Omit<GoogleTokens, "refreshToken">> {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new GoogleCalendarError(googleError(payload, "Falha ao renovar acesso ao calendário"), response.status, false);
  }
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: typeof payload.scope === "string" ? payload.scope : GOOGLE_CALENDAR_SCOPES.join(" "),
  };
}

export async function getGoogleAccountEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.email !== "string") {
    throw new GoogleCalendarError(googleError(payload, "Não foi possível identificar a conta Google"), response.status, false);
  }
  return payload.email.toLowerCase();
}

export async function isGoogleCalendarSlotAvailable(
  accessToken: string,
  calendarId: string,
  start: Date,
  end: Date,
  timezone: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new GoogleCalendarError(googleError(payload, "Falha ao consultar disponibilidade"), response.status, response.status >= 500);
  }
  const calendars = payload.calendars as Record<string, { busy?: unknown[]; errors?: unknown[] }> | undefined;
  const calendar = calendars?.[calendarId];
  if (!calendar || (calendar.errors?.length ?? 0) > 0) {
    throw new GoogleCalendarError("Calendário não retornou disponibilidade válida", response.status, false);
  }
  return (calendar.busy?.length ?? 0) === 0;
}

export async function createGoogleCalendarMeeting(
  input: GoogleCalendarEventInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ eventId: string; htmlLink: string | null; meetLink: string | null }> {
  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`,
  );
  endpoint.search = new URLSearchParams({ sendUpdates: "all", conferenceDataVersion: "1" }).toString();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timezone },
      attendees: [{ email: input.attendeeEmail }],
      conferenceData: {
        createRequest: {
          requestId: input.conferenceRequestId,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.id !== "string") {
    throw new GoogleCalendarError(googleError(payload, "Falha ao criar reunião"), response.status, response.status === 429 || response.status >= 500);
  }
  return {
    eventId: payload.id,
    htmlLink: typeof payload.htmlLink === "string" ? payload.htmlLink : null,
    meetLink: typeof payload.hangoutLink === "string" ? payload.hangoutLink : null,
  };
}

/**
 * Troca o convidado de um evento ja criado e reenvia o convite.
 *
 * Existe por um caso real: o agente criou a reuniao com um e-mail inventado e
 * so depois perguntou o endereco certo. Sem isso, o convite fica preso no
 * destinatario errado e o lead nunca recebe nada.
 */
export async function updateGoogleCalendarAttendee(
  input: {
    accessToken: string;
    calendarId: string;
    eventId: string;
    attendeeEmail: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const endpoint = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
  );
  endpoint.search = new URLSearchParams({ sendUpdates: "all" }).toString();
  const response = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ attendees: [{ email: input.attendeeEmail }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new GoogleCalendarError(
      googleError(payload, "Falha ao atualizar o convidado da reunião"),
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }
}
