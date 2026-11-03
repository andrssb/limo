// Crawler module — the new core of the Garimpo IA (Phase 2 of the modular reorg).
// Isolated from the legacy enrichment engine; it only reuses pure helpers
// (role expansion, phone extraction, scoring, evidence). v1 sources: the
// extension-fed base (enr_people) + the company's official site. NO open web
// search yet — the architecture is adapter-based so sources can be added later.

import type { ConfidenceLevel, PhoneKind } from "../enrichment/engine/confidence_scorer.js";

export interface PersonaQuery {
  roleName:            string;   // cargo-alvo principal, ex. "Diretor Comercial"
  roleNames?:          string[]; // multi-área: responsável de CADA área (principal + áreas da dor)
  painPoint?:          string;
  productDescription?: string;
  sector?:             string;
}

export interface CompanyRef {
  name:        string;
  tradeName?:  string;
  cnpj?:       string;
  domain?:     string;   // canonical or raw; normalized internally
  companyId?:  string;   // enr_companies.id — required to persist evidence
  city?:       string;
  state?:      string;
}

export interface EvidenceItem {
  field:    string;   // "persona" | "email" | "phone" | "linkedin" | ...
  value:    string;
  source:   string;   // "extension" | "company_site" | ...
  url?:     string;
  snippet?: string;   // excerpt where the data appeared
  score:    number;   // 0-100
}

export interface DecisionMaker {
  firstName:       string;
  lastName:        string;
  jobTitle:        string;
  companyName:     string;
  linkedinUrl?:    string;
  email?:          string;
  emailConfidence?: ConfidenceLevel;
  phone?:          string;
  phoneKind?:      PhoneKind;
  adherenceScore:  number;          // how well the title matches the persona (0-100)
  confidenceScore: number;          // overall confidence the person is real & current (0-100)
  confidenceLevel: ConfidenceLevel;
  sources:         string[];        // provenance, e.g. ["extension", "company_site"]
  evidence:        EvidenceItem[];
}

export type CrawlResult =
  | { status: "found";     decisionMakers: DecisionMaker[]; companyLinkedin?: string; trace?: string[] }
  | { status: "not_found"; reason: string; companyLinkedin?: string; trace?: string[] };
