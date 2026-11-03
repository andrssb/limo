// LinkedIn content script — scraping only (UI lives in the side panel)

const PHONE_RE = /(?:\+?55[\s\-.]?)?(?:\(?\d{2}\)?\s*(?:9\s?)?\d{4}[\s\-.]?\d{4})/g;
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCsrfToken(): string {
  return document.cookie.match(/(?:^|;\s*)JSESSIONID="?([^";]+)"?/)?.[1] ?? "";
}

function voyagerHeaders() {
  return {
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "x-restli-protocol-version": "2.0.0",
    "csrf-token": getCsrfToken(),
  };
}

function getVanityName(): string | null {
  return window.location.pathname.match(/^\/in\/([^/?#]+)/)?.[1] ?? null;
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function guessDomains(companyName: string): string[] {
  const clean = companyName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+(s\.?a\.?|ltda\.?|inc\.?|corp\.?|llc\.?|me\.?|epp\.?)$/i, "")
    .replace(/[^a-z0-9]/g, "");
  if (clean.length < 3) return [];
  return [`${clean}.com.br`, `${clean}.com`];
}

function guessDomain(companyName: string): string | null {
  return guessDomains(companyName)[0] ?? null;
}

// ─── DOM: current company fallback ───────────────────────────────────────────
// Used when Voyager API doesn't return position data (e.g. rate-limited).
// LinkedIn changes its DOM frequently — we try several known selector patterns.

function extractCurrentCompanyFromDOM(): string | null {
  const clean = (s: string | null | undefined): string | null => {
    if (!s) return null;
    const t = s.replace(/\s+/g, " ").split("·")[0]?.trim() ?? "";
    return t.length > 1 && !/^https?:/i.test(t) ? t : null;
  };

  // Pattern A (most reliable): a link to /company/<slug> inside the top card.
  // LinkedIn always renders the current company as such a link in the profile header.
  const topCard =
    document.querySelector("main section:first-of-type") ??
    document.querySelector("[class*='pv-top-card']") ??
    document.querySelector("[data-view-name='profile-card']") ??
    document.body;

  const companyLinks = Array.from(topCard.querySelectorAll("a[href*='/company/']")) as HTMLAnchorElement[];
  for (const link of companyLinks) {
    const txt = clean(link.textContent);
    if (txt) return txt;
    const aria = clean(link.getAttribute("aria-label"));
    if (aria) return aria;
    const imgAlt = link.querySelector("img")?.getAttribute("alt");
    const altClean = clean(imgAlt?.replace(/\s*logo\s*$/i, ""));
    if (altClean) return altClean;
  }

  // Pattern B: "Company · Role" subtitle (older 2024-2025 layout)
  const subtitleEl =
    document.querySelector(".pv-text-details__right-panel .optional-action-target-wrapper") ??
    document.querySelector(".pv-text-details__right-panel .inline-show-more-text");
  const subtitleVal = clean(subtitleEl?.textContent);
  if (subtitleVal) return subtitleVal;

  // Pattern C: experience section first entry
  const expEntries = document.querySelectorAll(
    "section#experience ~ div .pvs-list__outer-container .pvs-list__item--line-separated, " +
    ".pvs-list__outer-container [data-view-name='profile-component-entity']:first-child"
  );
  for (const entry of Array.from(expEntries).slice(0, 1)) {
    const companySpan = entry.querySelector(".t-14.t-normal.t-black span[aria-hidden='true']");
    const v = clean(companySpan?.textContent);
    if (v) return v;
  }

  // Pattern D: multilingual aria-label ("Current company" / "Empresa atual")
  const ariaSelectors = [
    "[aria-label*='Current company']",
    "[aria-label*='Empresa atual']",
    "[aria-label*='Empresa actual']",
  ];
  for (const sel of ariaSelectors) {
    const el = document.querySelector(`${sel} span[aria-hidden='true']`) ?? document.querySelector(sel);
    const v = clean(el?.textContent);
    if (v) return v;
  }

  // Pattern E: og:title / <title> — typically "Name - Role at Company | LinkedIn"
  const ogTitle =
    document.querySelector("meta[property='og:title']")?.getAttribute("content") ?? document.title;
  if (ogTitle) {
    const head = ogTitle.split("|")[0]?.trim() ?? "";
    const atMatch = head.match(/\s(?:at|em|na|no|en)\s+(.+)$/i);
    if (atMatch) {
      const v = clean(atMatch[1]);
      if (v) return v;
    }
    const parts = head.split(/\s-\s/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      const v = clean(parts[parts.length - 1]);
      if (v) return v;
    }
  }

  return null;
}

// ─── DOM extraction ───────────────────────────────────────────────────────────
// Tries many selectors — LinkedIn frequently changes class names

function extractFromDOM() {
  // Name: try several known selectors then fall back to page title
  const nameEl =
    document.querySelector("h1.text-heading-xlarge") ??
    document.querySelector("h1[class*='inline']") ??
    document.querySelector("[class*='top-card'] h1") ??
    document.querySelector(".pv-text-details__left-panel h1") ??
    document.querySelector(".ph5 h1") ??
    document.querySelector("main h1");

  let fullName = nameEl?.textContent?.trim() ?? "";

  // Title fallback: "João Silva - Cargo | LinkedIn"
  if (!fullName) {
    const titlePart = document.title.split("|")[0]?.split("-")[0]?.trim() ?? "";
    if (titlePart && titlePart.toLowerCase() !== "linkedin") fullName = titlePart;
  }

  const [firstName = "", ...rest] = fullName.split(" ");
  const lastName = rest.join(" ");

  // Headline
  const headlineEl =
    document.querySelector(".text-body-medium.break-words") ??
    document.querySelector("[class*='top-card__subline']") ??
    document.querySelector("[class*='headline']") ??
    document.querySelector(".pv-text-details__left-panel .text-body-medium");

  // Location
  const locationEl =
    document.querySelector(".text-body-small.inline.t-black--light.break-words") ??
    document.querySelector("[class*='top-card__flavor--bullet']") ??
    document.querySelector("[class*='pv-text-details'] span.t-black--light");

  const emailEl = document.querySelector("a[href^='mailto:']");

  return {
    firstName,
    lastName,
    headline: headlineEl?.textContent?.trim() ?? null,
    location: locationEl?.textContent?.trim() ?? null,
    email:    emailEl?.getAttribute("href")?.replace("mailto:", "") ?? null,
  };
}

// ─── Page text scan (aggressive) ─────────────────────────────────────────────

function extractFromPageText() {
  const text = document.body?.innerText ?? "";

  const phones = [...new Set(
    (text.match(PHONE_RE) ?? [])
      .map((p) => p.replace(/[^\d+]/g, ""))
      .filter((p) => p.replace(/\D/g, "").length >= 10)
  )];

  const emails = [...new Set(
    (text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase())
  )].filter((e) => !e.endsWith("linkedin.com") && !e.includes("example.") && e.includes("@"));

  return { phones, emails };
}

// ─── Voyager: contact info ────────────────────────────────────────────────────

async function fetchVoyagerContactInfo(vanity: string) {
  try {
    const res = await fetch(
      `https://www.linkedin.com/voyager/api/identity/profiles/${vanity}/profileContactInfo`,
      { credentials: "include", headers: voyagerHeaders() }
    );
    if (!res.ok) return { email: null, phone: null, twitter: null, website: null };
    const json = await res.json();
    const d = json.data ?? json;
    return {
      email:   d.emailAddress             ?? null,
      phone:   d.phoneNumbers?.[0]?.number ?? null,
      twitter: d.twitterHandles?.[0]?.name ?? null,
      website: d.websites?.[0]?.url        ?? null,
    };
  } catch {
    return { email: null, phone: null, twitter: null, website: null };
  }
}

// ─── Voyager: full profile + positions ───────────────────────────────────────

async function fetchVoyagerProfile(vanity: string) {
  try {
    const [profileRes, positionsRes] = await Promise.all([
      fetch(`https://www.linkedin.com/voyager/api/identity/profiles/${vanity}`, {
        credentials: "include", headers: voyagerHeaders(),
      }),
      fetch(`https://www.linkedin.com/voyager/api/identity/profiles/${vanity}/positions`, {
        credentials: "include", headers: voyagerHeaders(),
      }),
    ]);

    // Profile data (name/headline/website). Tolerate failure — positions alone
    // still gives us the company, which is what enrichment needs most.
    let d: any = {};
    if (profileRes.ok) {
      const pJson = await profileRes.json();
      d = pJson.data ?? pJson;
    }

    // Positions endpoint — the authoritative source for the CURRENT company.
    // LinkedIn has changed the response envelope several times; try all known paths.
    let posElements: any[] = [];
    if (positionsRes.ok) {
      const posJson = await positionsRes.json();
      posElements =
        posJson.elements ??
        posJson.data?.elements ??
        posJson.data?.paging?.elements ??
        (Array.isArray(posJson.included) ? posJson.included.filter((x: any) => x.$type?.toLowerCase().includes("position")) : null) ??
        [];
    }

    const companyOf = (el: any): string | null => el?.companyName ?? el?.company?.name ?? null;

    // Current company: prefer profile-embedded, then the first position.
    const currentCompany: string | null =
      companyOf(d.positions?.elements?.[0]) ?? companyOf(posElements[0]);
    // Current role title — used as jobTitle fallback when the headline is empty.
    const currentTitle: string | null =
      d.positions?.elements?.[0]?.title ?? posElements[0]?.title ?? null;

    const allDomains: string[] = [];
    const pushDomain = (dom: string) => { if (dom && !allDomains.includes(dom)) allDomains.push(dom); };

    // Real website URL from profile (most reliable domain source).
    const websiteUrl: string | null = d.websites?.[0]?.url ?? null;
    if (websiteUrl) {
      try { pushDomain(new URL(websiteUrl).hostname.replace(/^www\./, "")); }
      catch { /* ignore malformed URLs */ }
    }

    // Guess domains from the current company + up to 3 past companies.
    const companyNames = [currentCompany, ...posElements.slice(0, 3).map(companyOf)]
      .filter((n): n is string => !!n);
    for (const cn of companyNames) for (const dom of guessDomains(cn)) pushDomain(dom);

    // DOM fallback for company when Voyager positions returned nothing
    const domCompany = !currentCompany ? extractCurrentCompanyFromDOM() : null;
    const company = currentCompany ?? domCompany;

    // Diagnostic log — visible in the page console; useful when company comes back null
    console.info("[Limo] company resolution:", {
      voyagerPositions: posElements.length,
      currentCompanyVoyager: currentCompany,
      domFallback: domCompany,
      final: company,
    });

    if (!d.firstName && !company && allDomains.length === 0) return null;

    return {
      firstName: d.firstName    ?? null,
      lastName:  d.lastName     ?? null,
      headline:  d.headline     ?? currentTitle ?? null,
      location:  d.locationName ?? null,
      company,
      website:   websiteUrl,
      allDomains,
    };
  } catch { return null; }
}

// ─── "Contact Info" modal click ───────────────────────────────────────────────

async function clickContactInfoAndScrape(): Promise<{ email: string | null; phone: string | null }> {
  const trigger = (
    document.querySelector("a[href*='overlay/contact-info']") ??
    document.querySelector("[data-control-name='contact_see_more']") ??
    [...document.querySelectorAll("a")].find((a) =>
      a.textContent?.toLowerCase().includes("contact info")
    )
  ) as HTMLElement | null;

  if (!trigger) return { email: null, phone: null };

  trigger.click();
  await wait(1400);

  const emailEl = document.querySelector(
    ".pv-contact-info__contact-type a[href^='mailto:'], section.pv-contact-info a[href^='mailto:']"
  );
  const phoneEl = document.querySelector(
    ".pv-contact-info__contact-type span.t-14, section.pv-contact-info .t-black"
  );

  const email  = emailEl?.getAttribute("href")?.replace("mailto:", "") ?? null;
  const rawPh  = phoneEl?.textContent?.trim() ?? null;
  const phone  = rawPh && /[\d+\-().\s]{7,}/.test(rawPh) ? rawPh : null;

  // Close the modal. LinkedIn has used many selectors over the years — try all.
  const closeBtn = document.querySelector(
    "button[data-test-modal-close-btn], " +
    "button.artdeco-modal__dismiss, " +
    ".artdeco-modal__dismiss, " +
    "button[aria-label='Dismiss'], " +
    "button[aria-label='Fechar'], " +
    "button[aria-label='Close'], " +
    "[data-test-dialog-close-btn]"
  ) as HTMLElement | null;

  if (closeBtn) {
    closeBtn.click();
  } else {
    // Last-resort: dispatch Escape key to close the overlay
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  }

  return { email, phone };
}

// ─── Main scraping flow ───────────────────────────────────────────────────────

let lastUrl  = location.href;
let scraping = false;

async function scrapeProfile() {
  if (scraping) return;
  if (!window.location.pathname.match(/^\/in\/[^/?#]+/)) return;

  const vanity = getVanityName();
  if (!vanity) return;

  scraping = true;
  try {

  // DOM extraction — retry up to 3x if name is still empty (page may still be rendering)
  let dom = extractFromDOM();
  if (!dom.firstName) {
    await wait(2000);
    dom = extractFromDOM();
  }
  if (!dom.firstName) {
    await wait(3000);
    dom = extractFromDOM();
  }

  // Use vanity as last-resort placeholder — Voyager API will get the real name
  const firstName = dom.firstName || vanity.split("-")[0] || vanity;
  const lastName  = dom.lastName  || vanity.split("-").slice(1).join(" ") || "";

  // Signal start immediately so the side panel shows a loading state
  chrome.runtime.sendMessage({
    type: "LINKEDIN_PROFILE_STARTED",
    payload: {
      linkedinUrl: window.location.href.split("?")[0]!,
      firstName,
      lastName,
      headline: dom.headline,
      location: dom.location,
    },
  }).catch(() => {});

  // Parallel: Voyager + page text scan
  const [voyagerProfile, voyagerContact, pageText] = await Promise.all([
    fetchVoyagerProfile(vanity),
    fetchVoyagerContactInfo(vanity),
    Promise.resolve(extractFromPageText()),
  ]);

  const state = {
    linkedinUrl:         window.location.href.split("?")[0]!,
    firstName:           voyagerProfile?.firstName ?? firstName,
    lastName:            voyagerProfile?.lastName  ?? lastName,
    headline:            voyagerProfile?.headline  ?? dom.headline,
    location:            voyagerProfile?.location  ?? dom.location,
    company:             voyagerProfile?.company   ?? null,
    allDomains:          voyagerProfile?.allDomains ?? [],
    email:               voyagerContact.email   ?? dom.email ?? pageText.emails[0] ?? null,
    phone:               voyagerContact.phone   ?? pageText.phones[0] ?? null,
    twitter:             voyagerContact.twitter ?? null,
    website:             voyagerContact.website ?? null,
    emailCandidates:     [] as string[],
    emailConfidence:     null as string | null,
  };

  // If Voyager found nothing, try the modal
  if (!state.email && !state.phone) {
    const modal = await clickContactInfoAndScrape();
    state.email = modal.email ?? pageText.emails[0] ?? null;
    state.phone = modal.phone ?? pageText.phones[0] ?? null;
  }

  // Backend enrichment via motor de enriquecimento
  const enrichRes = await chrome.runtime.sendMessage({
    type:    "ENRICH_CONTACT",
    payload: {
      firstName:     state.firstName,
      lastName:      state.lastName,
      linkedinUrl:   state.linkedinUrl,
      email:         state.email    ?? undefined,
      phone:         state.phone    ?? undefined,
      companyName:   state.company  ?? undefined,
      jobTitle:      state.headline ?? undefined,
      allDomains:    state.allDomains,
      companyDomain: state.company ? (guessDomain(state.company) ?? undefined) : undefined,
    },
  }).catch(() => null);

  if (enrichRes?.success) {
    const d = enrichRes.data as any;
    state.email           ??= d?.email  ?? null;
    state.phone           ??= d?.phone  ?? null;
    state.emailCandidates   = d?.emailsFound    ?? [];
    state.emailConfidence   = d?.emailConfidence ?? null;
  }

  // If the user already switched profiles mid-scrape, don't clobber the panel
  // with stale data — the newer scrape will deliver the right profile.
  if (getVanityName() !== vanity) return;

  chrome.runtime.sendMessage({ type: "LINKEDIN_PROFILE_DONE", payload: state }).catch(() => {});
  } finally {
    scraping = false;
  }
}

// ─── Manual re-scrape trigger from side panel ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "TRIGGER_LINKEDIN_SCRAPE") {
    scraping = false;
    scrapeProfile().catch(() => {});
    sendResponse({ ok: true });
  }
  return true;
});

// ─── SPA navigation observer ──────────────────────────────────────────────────

new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl  = location.href;
    scraping = false;
    setTimeout(scrapeProfile, 2000);
  }
}).observe(document.body, { childList: true, subtree: true });

setTimeout(scrapeProfile, 2500);
