import { create } from "zustand";
import type { Contact, CallAnalysis, LinkedInProfileData } from "@limo/types";

export type View = "home" | "contact" | "content" | "settings" | "coaching" | "linkedin";

export interface LinkedInState extends LinkedInProfileData {
  enriching: boolean;
}

interface AuthState {
  accessToken: string | null;
  user: { id: string; name: string; email: string; role: string } | null;
}

interface UIState {
  activeContact: Contact | null;
  flashSummary: CallAnalysis | null;
  isGenerating: boolean;
  generatedContent: string | null;
  view: View;
  linkedInData: LinkedInState | null;
}

interface AppStore extends AuthState, UIState {
  setAuth: (token: string, user: AppStore["user"]) => void;
  logout: () => void;
  setActiveContact: (contact: Contact | null) => void;
  setFlashSummary: (analysis: CallAnalysis | null) => void;
  setGenerating: (v: boolean) => void;
  setGeneratedContent: (content: string | null) => void;
  setView: (view: View) => void;
  setLinkedInData: (data: LinkedInState | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  accessToken: null,
  user: null,
  activeContact: null,
  flashSummary: null,
  isGenerating: false,
  generatedContent: null,
  view: "home",
  linkedInData: null,

  setAuth: (accessToken, user) => {
    chrome.storage.local.set({ accessToken });
    set({ accessToken, user });
  },
  logout: () => {
    chrome.storage.local.remove(["accessToken"]);
    set({ accessToken: null, user: null, activeContact: null });
  },
  setActiveContact: (contact) => set({ activeContact: contact, view: contact ? "contact" : "home" }),
  setFlashSummary: (analysis) => set({ flashSummary: analysis }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setGeneratedContent: (generatedContent) => set({ generatedContent }),
  setView: (view: View) => set({ view }),
  setLinkedInData: (linkedInData) => set({ linkedInData }),
}));
