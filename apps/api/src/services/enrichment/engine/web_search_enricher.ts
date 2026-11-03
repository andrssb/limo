import { config } from "../../../config.js";

function extractDomainFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, "") || null;
  } catch { return null; }
}

// ─── Google Maps Places API ───────────────────────────────────────────────────
// Uses findplacefromtext to get the website field for a given company name.

// Places API (New) — Text Search. A API LEGADA (findplacefromtext) não é mais
// habilitável em projetos novos do Google Cloud (retorna REQUEST_DENIED), então
// usamos places:searchText. FieldMask só `websiteUri` — o campo que precisamos —
// pra segurar o SKU/custo. Precisa da "Places API (New)" ativada no projeto.
export async function findDomainViaGooglePlaces(
  companyName: string,
  city?: string,
): Promise<string | null> {
  if (!config.GOOGLE_PLACES_API_KEY) return null;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type":     "application/json",
        "X-Goog-Api-Key":   config.GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.websiteUri",
      },
      body: JSON.stringify({
        textQuery:      `${companyName}${city ? ` ${city}` : ""} Brasil`,
        regionCode:     "BR",
        languageCode:   "pt-BR",
        maxResultCount: 1,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const website: string | undefined = data.places?.[0]?.websiteUri;
    if (!website) return null;

    return extractDomainFromUrl(website);
  } catch { return null; }
}

// ─── Bing Web Search API v7 ───────────────────────────────────────────────────
// Searches for "<companyName> site oficial" and returns the first result's domain.

export async function findDomainViaBing(
  companyName: string,
  state?: string,
): Promise<string | null> {
  if (!config.BING_SEARCH_API_KEY) return null;

  try {
    const query = encodeURIComponent(
      `"${companyName}"${state ? ` ${state}` : ""} site oficial -linkedin -facebook -instagram`,
    );
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${query}&count=1&mkt=pt-BR&responseFilter=Webpages`;

    const res = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": config.BING_SEARCH_API_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const data: any = await res.json();
    const firstUrl: string | undefined = data.webPages?.value?.[0]?.url;
    if (!firstUrl) return null;

    return extractDomainFromUrl(firstUrl);
  } catch { return null; }
}

