import { config } from "../../config.js";
import type { Contact, Call, CallAnalysis } from "@limo/types";

export function getSalesforceAuthUrl(): string {
  return `https://login.salesforce.com/services/oauth2/authorize?response_type=code&client_id=${config.SALESFORCE_CLIENT_ID}&redirect_uri=${encodeURIComponent(config.SALESFORCE_REDIRECT_URI!)}&scope=api+refresh_token+offline_access`;
}

export async function exchangeSalesforceCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
}> {
  const res = await fetch("https://login.salesforce.com/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.SALESFORCE_CLIENT_ID!,
      client_secret: config.SALESFORCE_CLIENT_SECRET!,
      redirect_uri: config.SALESFORCE_REDIRECT_URI!,
      code,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce code exchange failed: ${res.status}`);
  const data = (await res.json()) as any;
  return { accessToken: data.access_token, refreshToken: data.refresh_token, instanceUrl: data.instance_url };
}

export async function refreshSalesforceToken(refreshToken: string): Promise<{
  accessToken: string;
  instanceUrl: string;
}> {
  const res = await fetch("https://login.salesforce.com/services/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.SALESFORCE_CLIENT_ID!,
      client_secret: config.SALESFORCE_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Salesforce token refresh failed: ${res.status}`);
  const data = (await res.json()) as any;
  return { accessToken: data.access_token, instanceUrl: data.instance_url };
}

async function sfFetch(
  path: string,
  instanceUrl: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${instanceUrl}/services/data/v59.0${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

export async function upsertSalesforceContact(
  contact: Contact,
  accessToken: string,
  instanceUrl: string
): Promise<string> {
  const payload = {
    FirstName: contact.firstName,
    LastName: contact.lastName,
    Email: contact.email ?? undefined,
    Phone: contact.phone ?? undefined,
    Account: contact.companyName ? { Name: contact.companyName } : undefined,
    Title: contact.jobTitle ?? undefined,
    LeadSource: "Limo",
  };

  if (contact.crmId) {
    await sfFetch(`/sobjects/Contact/${contact.crmId}`, instanceUrl, accessToken, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return contact.crmId;
  }

  const res = await sfFetch("/sobjects/Contact", instanceUrl, accessToken, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Salesforce contact creation failed: ${res.status}`);
  const data = (await res.json()) as any;
  return data.id as string;
}

export async function logSalesforceTask(
  contactCrmId: string,
  call: Call,
  analysis: CallAnalysis | null,
  accessToken: string,
  instanceUrl: string
): Promise<void> {
  const description = analysis
    ? `Resultado: ${call.result}\n${analysis.flashSummary}\n\nPróximo passo: ${analysis.nextStep}`
    : `Ligação registrada via Limo. Duração: ${call.durationSeconds}s`;

  await sfFetch("/sobjects/Task", instanceUrl, accessToken, {
    method: "POST",
    body: JSON.stringify({
      Subject: `Ligação Limo — ${new Date(call.startedAt).toLocaleDateString("pt-BR")}`,
      WhoId: contactCrmId,
      Status: "Completed",
      Priority: "Normal",
      Type: "Call",
      Description: description,
      ActivityDate: new Date(call.startedAt).toISOString().split("T")[0],
      CallDurationInSeconds: call.durationSeconds ?? 0,
      CallType: call.direction === "outbound" ? "Outbound" : "Inbound",
    }),
  });
}
