import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { LoginView }    from "./views/LoginView.js";
import { HomeView }     from "./views/HomeView.js";
import { ContactView }  from "./views/ContactView.js";
import { ContentView }  from "./views/ContentView.js";
import { CoachingView } from "./views/CoachingView.js";
import { LinkedInView } from "./views/LinkedInView.js";
import { FlashSummary } from "./components/FlashSummary.js";
import { track } from "../lib/telemetry.js";

function vanityOf(url?: string | null): string | undefined {
  return url?.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1];
}

export function App() {
  const { accessToken, user, view, flashSummary, setAuth } = useStore();
  const [loading, setLoading] = useState(true);

  // Vanity for which we've already asked the content script to (re)scrape, so we
  // don't spam TRIGGER while a scrape is in flight.
  const pendingVanityRef = useRef<string | null>(null);

  useEffect(() => {
    // Telemetria anônima do funil: painel aberto. Fire-and-forget.
    track("app_open");

    // ── Keep the panel aligned with whatever LinkedIn profile the active tab
    // shows. Runs on mount, on tab switch, and on in-tab navigation (SPA or full).
    // If the tab shows a profile we're not displaying, we proactively trigger a
    // scrape instead of passively waiting for a message that may never arrive.
    async function syncToActiveTab() {
      let tabUrl = "";
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabUrl = tab?.url ?? "";
      } catch { return; }

      const tabVanity = vanityOf(tabUrl);
      if (!tabVanity) return; // not a profile page — leave the current view alone

      const store = useStore.getState();
      const shownVanity = vanityOf(store.linkedInData?.linkedinUrl);

      // Already showing this exact profile → just make sure we're on the view.
      if (shownVanity === tabVanity && store.linkedInData) {
        pendingVanityRef.current = null;
        if (store.view !== "linkedin") store.setView("linkedin");
        return;
      }

      // Different profile (or nothing shown). Prefer fresh-enough cached data,
      // otherwise clear and ask the content script to scrape THIS profile.
      const stored = await chrome.storage.local.get(["linkedin_data"]).catch(() => ({} as any));
      const storedVanity = vanityOf(stored.linkedin_data?.linkedinUrl);

      if (storedVanity === tabVanity && stored.linkedin_data) {
        pendingVanityRef.current = null;
        store.setLinkedInData({ ...stored.linkedin_data, enriching: false });
      } else {
        store.setLinkedInData(null);
        if (pendingVanityRef.current !== tabVanity) {
          pendingVanityRef.current = tabVanity;
          chrome.runtime.sendMessage({ type: "TRIGGER_LINKEDIN_SCRAPE" }).catch(() => {});
        }
      }
      store.setView("linkedin");
    }

    // ── Bootstrap: restore auth, then sync to the active tab ─────────────────
    chrome.storage.local.get(["accessToken", "user"], async (result) => {
      if (result.accessToken && result.user) setAuth(result.accessToken, result.user);
      await syncToActiveTab();
      setLoading(false);
    });

    // ── Live updates pushed by the content script ────────────────────────────
    const handler = (msg: any) => {
      const store = useStore.getState();

      if (msg.type === "FLASH_SUMMARY") {
        store.setFlashSummary(msg.payload);
        return;
      }

      if (msg.type === "LINKEDIN_PROFILE_STARTED") {
        pendingVanityRef.current = null; // request fulfilled
        store.setLinkedInData({
          ...msg.payload,
          company:         null,
          allDomains:      [],
          email:           null,
          phone:           null,
          twitter:         null,
          website:         null,
          emailCandidates: [],
          emailConfidence: null,
          enriching:       true,
        });
        if (store.view !== "linkedin") store.setView("linkedin");
      }

      if (msg.type === "LINKEDIN_PROFILE_DONE") {
        pendingVanityRef.current = null;
        store.setLinkedInData({ ...msg.payload, enriching: false });
        if (store.view !== "linkedin") store.setView("linkedin");
      }
    };
    chrome.runtime.onMessage.addListener(handler);

    // ── Login ao vivo: o service worker grava o token vindo do cadastro na web
    // (handoff). Quando accessToken aparece no storage, o painel loga na hora,
    // sem a pessoa precisar reabrir/relogar.
    const onStorageChanged = (
      changes: { [k: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local" || !changes.accessToken?.newValue) return;
      chrome.storage.local.get(["accessToken", "user"], (r) => {
        if (r.accessToken && r.user) setAuth(r.accessToken, r.user);
      });
    };
    chrome.storage.onChanged.addListener(onStorageChanged);

    // ── Follow the active tab: profile switches + tab activation ─────────────
    const onTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab?.active && (changeInfo.url || changeInfo.status === "complete")) syncToActiveTab();
    };
    const onTabActivated = () => syncToActiveTab();
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    chrome.tabs.onActivated.addListener(onTabActivated);

    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      chrome.storage.onChanged.removeListener(onStorageChanged);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
      chrome.tabs.onActivated.removeListener(onTabActivated);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <span style={{ color: "#666", fontSize: "12px" }}>Carregando...</span>
      </div>
    );
  }

  if (!accessToken || !user) return <LoginView />;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header />
      {flashSummary && <FlashSummary analysis={flashSummary} />}
      <main style={{ flex: 1, overflow: "auto" }}>
        {view === "home"     && <HomeView />}
        {view === "contact"  && <ContactView />}
        {view === "content"  && <ContentView />}
        {view === "coaching" && <CoachingView />}
        {view === "linkedin" && <LinkedInView />}
      </main>
    </div>
  );
}

function Header() {
  const { user, view, logout } = useStore();
  const logoUrl = chrome.runtime.getURL("icons/icon128.png");

  // Hide header on scraping views to save vertical space
  const minimal = view === "linkedin" || view === "company";

  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: minimal ? "8px 14px" : "10px 14px",
      borderBottom: "1px solid #dde4ee",
      background: "#ffffff",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <img src={logoUrl} alt="Limo" style={{ width: minimal ? 22 : 28, height: minimal ? 22 : 28, objectFit: "contain" }} />
        <span style={{ fontSize: minimal ? "13px" : "15px", fontWeight: 900, color: "#1a2332", letterSpacing: "-0.01em" }}>Limo</span>
      </div>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "#8898aa" }}>{user?.name?.split(" ")[0]}</span>
        <button
          onClick={logout}
          style={{ background: "none", border: "none", color: "#8898aa", cursor: "pointer", fontSize: "11px", fontFamily: "inherit", fontWeight: 900 }}
        >
          sair
        </button>
      </div>
    </div>
  );
}
