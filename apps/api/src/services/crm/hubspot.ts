import { config } from "../../config.js";
import { decrypt } from "../../lib/crypto.js";
import type { Contact, Call, CallAnalysis } from "@limo/types";

const BASE = "https://api.hubapi.com";

async function hubspotFetch(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

export async function refreshHubSpotToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.HUBSPOT_CLIENT_ID!,
      client_secret: config.HUBSPOT_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export function getHubSpotAuthUrl(): string {
  const scopes = [
    "oauth",
    "crm.objects.contacts.read",
    "crm.objects.contacts.write",
    "crm.objects.deals.read",
    "crm.objects.deals.write",
  ].join(" ");
  return `https://app.hubspot.com/oauth/authorize?client_id=${config.HUBSPOT_CLIENT_ID}&redirect_uri=${encodeURIComponent(config.HUBSPOT_REDIRECT_URI!)}&scope=${encodeURIComponent(scopes)}`;
}

export async function exchangeHubSpotCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.HUBSPOT_CLIENT_ID!,
      client_secret: config.HUBSPOT_CLIENT_SECRET!,
      redirect_uri: config.HUBSPOT_REDIRECT_URI!,
      code,
    }),
  });
  if (!res.ok) throw new Error(`HubSpot code exchange failed: ${res.status}`);
  const data = (await res.json()) as any;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function upsertHubSpotContact(
  contact: Contact,
  accessToken: string
): Promise<string> {
  const properties = {
    firstname: contact.firstName,
    lastname: contact.lastName,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    company: contact.companyName ?? "",
    jobtitle: contact.jobTitle ?? "",
    hs_lead_status: temperatureToHsStatus(contact.temperature),
  };

  const res = await hubspotFetch(
    contact.crmId ? `/crm/v3/objects/contacts/${contact.crmId}` : "/crm/v3/objects/contacts",
    accessToken,
    {
      method: contact.crmId ? "PATCH" : "POST",
      body: JSON.stringify({ properties }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HubSpot contact upsert failed: ${err}`);
  }

  const data = (await res.json()) as any;
  return data.id as string;
}

export async function logHubSpotCall(
  contactCrmId: string,
  call: Call,
  analysis: CallAnalysis | null,
  accessToken: string
): Promise<void> {
  const notes = analysis
    ? `Resultado: ${call.result}\n\n${analysis.flashSummary}\n\nPróximo passo: ${analysis.nextStep}`
    : `Ligação registrada via Limo. Duração: ${call.durationSeconds}s`;

  await hubspotFetch("/crm/v3/objects/calls", accessToken, {
    method: "POST",
    body: JSON.stringify({
      properties: {
        hs_call_title: `Ligação Limo — ${new Date(call.startedAt).toLocaleDateString("pt-BR")}`,
        hs_call_duration: (call.durationSeconds ?? 0) * 1000,
        hs_call_direction: call.direction === "outbound" ? "OUTBOUND" : "INBOUND",
        hs_call_status: call.result === "positive" ? "COMPLETED" : "NO_ANSWER",
        hs_call_body: notes,
        hs_timestamp: new Date(call.startedAt).getTime(),
      },
      associations: [
        {
          to: { id: contactCrmId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 194 }],
        },
      ],
    }),
  });
}

function temperatureToHsStatus(temp: string): string {
  if (temp === "hot") return "IN_PROGRESS";
  if (temp === "warm") return "OPEN";
  return "NEW";
}
