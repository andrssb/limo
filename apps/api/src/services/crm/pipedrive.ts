import { config } from "../../config.js";
import type { Contact, Call, CallAnalysis } from "@limo/types";

const BASE = "https://api.pipedrive.com/v1";

async function pdFetch(path: string, accessToken: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

export function getPipedriveAuthUrl(): string {
  return `https://oauth.pipedrive.com/oauth/authorize?client_id=${config.PIPEDRIVE_CLIENT_ID}&redirect_uri=${encodeURIComponent(config.PIPEDRIVE_REDIRECT_URI!)}`;
}

export async function exchangePipedriveCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const credentials = Buffer.from(`${config.PIPEDRIVE_CLIENT_ID}:${config.PIPEDRIVE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.pipedrive.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.PIPEDRIVE_REDIRECT_URI! }),
  });
  if (!res.ok) throw new Error(`Pipedrive code exchange failed: ${res.status}`);
  const data = (await res.json()) as any;
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export async function refreshPipedriveToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const credentials = Buffer.from(`${config.PIPEDRIVE_CLIENT_ID}:${config.PIPEDRIVE_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://oauth.pipedrive.com/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`Pipedrive token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
}

export async function upsertPipedriveContact(contact: Contact, accessToken: string): Promise<string> {
  const payload = {
    name: `${contact.firstName} ${contact.lastName}`,
    email: contact.email ? [{ value: contact.email, primary: true }] : [],
    phone: contact.phone ? [{ value: contact.phone, primary: true }] : [],
    org_name: contact.companyName ?? undefined,
  };

  if (contact.crmId) {
    await pdFetch(`/persons/${contact.crmId}`, accessToken, { method: "PUT", body: JSON.stringify(payload) });
    return contact.crmId;
  }

  const res = await pdFetch("/persons", accessToken, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Pipedrive contact creation failed: ${res.status}`);
  const data = (await res.json()) as any;
  return String(data.data.id);
}

export async function logPipedriveActivity(
  contactCrmId: string,
  call: Call,
  analysis: CallAnalysis | null,
  accessToken: string
): Promise<void> {
  const note = analysis
    ? `Resultado: ${call.result}\n${analysis.flashSummary}\n\nPróximo passo: ${analysis.nextStep}`
    : `Ligação registrada via Limo. Duração: ${call.durationSeconds}s`;

  await pdFetch("/activities", accessToken, {
    method: "POST",
    body: JSON.stringify({
      subject: `Ligação Limo — ${new Date(call.startedAt).toLocaleDateString("pt-BR")}`,
      type: "call",
      person_id: parseInt(contactCrmId, 10),
      done: 1,
      duration: call.durationSeconds ? `${Math.floor(call.durationSeconds / 60).toString().padStart(2, "0")}:${(call.durationSeconds % 60).toString().padStart(2, "0")}` : "00:00",
      note,
      due_date: new Date(call.startedAt).toISOString().split("T")[0],
    }),
  });
}
