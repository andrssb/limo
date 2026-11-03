import { promises as dns } from "dns";

export type EmailConfidence = "verified" | "probable" | "guessed";

export interface EmailCandidate {
  address:    string;
  confidence: EmailConfidence;
}

// ─── Name normalisation ────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ─── Pattern generation ────────────────────────────────────────────────────────

export function generateEmailCandidates(firstName: string, lastName: string, domain: string): string[] {
  const f  = norm(firstName);
  const l  = norm(lastName);
  const fi = f[0] ?? "";
  const li = l[0] ?? "";

  return [
    `${f}.${l}@${domain}`,
    `${fi}.${l}@${domain}`,
    `${fi}${l}@${domain}`,
    `${f}@${domain}`,
    `${f}${l}@${domain}`,
    `${l}.${f}@${domain}`,
    `${l}${f}@${domain}`,
    `${f}_${l}@${domain}`,
    `${f}-${l}@${domain}`,
    `${fi}${li}@${domain}`,
  ].filter((e, i, a) => e.split("@")[0]!.length >= 2 && a.indexOf(e) === i);
}

// ─── MX record lookup ──────────────────────────────────────────────────────────

async function getMxHost(domain: string): Promise<string | null> {
  try {
    const records = await dns.resolveMx(domain);
    return records.sort((a, b) => a.priority - b.priority)[0]?.exchange ?? null;
  } catch {
    return null;
  }
}

// ─── Mail provider detection ───────────────────────────────────────────────────
// Different providers have strong pattern preferences. Using this we can rank
// candidates without needing SMTP (port 25 is typically blocked by ISPs).

const PROVIDER_PREFERRED: Record<string, number[]> = {
  // Google Workspace → firstname.lastname wins by a large margin
  "google.com":       [0, 1, 2, 3],
  "googlemail.com":   [0, 1, 2, 3],
  // Microsoft 365 / Exchange
  "outlook.com":      [0, 1, 2, 3],
  "protection.outlook.com": [0, 1, 2, 3],
  // Zoho
  "zoho.com":         [0, 2, 3],
  // Locaweb (common in Brazil)
  "locaweb.com.br":   [0, 2, 1],
  // UOL / Kinghost (Brazil)
  "uol.com.br":       [0, 3, 2],
  "kinghost.net":     [0, 2, 1],
};

function getPreferredIndices(mxHost: string): number[] {
  for (const [key, indices] of Object.entries(PROVIDER_PREFERRED)) {
    if (mxHost.includes(key)) return indices;
  }
  return [0, 1, 2, 3]; // generic: all equally plausible
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function findBestEmail(
  firstName: string,
  lastName:  string,
  domains:   string[]
): Promise<EmailCandidate | null> {
  for (const domain of domains) {
    const mxHost = await getMxHost(domain);
    if (!mxHost) continue;

    const all        = generateEmailCandidates(firstName, lastName, domain);
    const preferred  = getPreferredIndices(mxHost);
    const topPick    = all[preferred[0] ?? 0];

    if (topPick) {
      // If we know the provider's preferred pattern, mark as "probable"
      const confidence: EmailConfidence = preferred.length > 0 ? "probable" : "guessed";
      return { address: topPick, confidence };
    }
  }
  return null;
}

export async function hasMxRecord(domain: string): Promise<boolean> {
  return !!(await getMxHost(domain));
}
