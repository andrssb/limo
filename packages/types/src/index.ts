// ─── Enums ──────────────────────────────────────────────────────────────────

export type UserRole = "sdr" | "bdr" | "manager" | "admin";
export type LeadTemperature = "cold" | "warm" | "hot";
export type ContactSource = "linkedin" | "website" | "manual" | "crm" | "import";
export type CallType = "whatsapp" | "manual" | "imported";
export type CallDirection = "inbound" | "outbound";
// Canal de captura do áudio (Fase 0 — ingestão agnóstica ao canal).
export type CallChannel = "browser" | "voip" | "upload" | "whatsapp";
export type CallResult = "positive" | "negative" | "neutral" | "inconclusive";
export type ProcessingStatus = "pending" | "processing" | "done" | "failed";
export type CRMProvider = "hubspot" | "pipedrive" | "salesforce";
export type MessageDirection = "inbound" | "outbound";
export type MessageType = "text" | "audio" | "image" | "document";
export type WhatsAppStatus = "connecting" | "connected" | "disconnected";
export type ContentType = "call_script" | "email" | "whatsapp";
export type KeyMomentType = "objection" | "buying_signal" | "mistake" | "win" | "silence" | "rapport";
export type FeedbackType = "talk_ratio" | "objection_handling" | "discovery" | "closing" | "rapport";

// ─── Entities ───────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  teamId: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  managerId: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  userId: string;
  teamId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  companyName: string | null;
  companyDomain: string | null;
  jobTitle: string | null;
  location: string | null;
  temperature: LeadTemperature;
  source: ContactSource;
  crmId: string | null;
  crmProvider: CRMProvider | null;
  enrichmentData: EnrichmentData | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnrichmentData {
  emailsFound: string[];
  phonesFound: string[];
  emailPattern: string | null;
  linkedinFollowers: number | null;
  companySize: string | null;
  companyIndustry: string | null;
  companyLinkedinUrl: string | null;
  lastEnrichedAt: string;
  sources: string[];
}

export interface Call {
  id: string;
  userId: string;
  contactId: string | null;
  type: CallType;
  direction: CallDirection;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  audioUrl: string | null;
  channel: CallChannel | null;
  sdrAudioUrl: string | null;
  leadAudioUrl: string | null;
  sourceMeta: Record<string, unknown> | null;
  transcriptionStatus: ProcessingStatus;
  transcriptionText: string | null;
  transcriptionSegments: TranscriptSegment[] | null;
  analysisStatus: ProcessingStatus;
  result: CallResult | null;
  createdAt: string;
}

export interface TranscriptSegment {
  speaker: "sdr" | "lead";
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface CallAnalysis {
  id: string;
  callId: string;
  result: CallResult;
  flashSummary: string;
  diagnosis: CallDiagnosis;
  nextStep: string;
  keyMoments: KeyMoment[];
  talkRatio: number;
  sentimentScore: number;
  // Fase 3 — score detalhado, frameworks detectados e análise de conversão/perda.
  // Opcionais: análises antigas (anteriores à Fase 3) não os têm.
  score?: CallScore | null;
  frameworks?: FrameworkDetection[] | null;
  outcome?: OutcomeAnalysis | null;
  createdAt: string;
}

// Score 0–100 por critério + nota geral (Fase 3).
export interface CallScore {
  overall: number;          // 0–100, composto
  opening: number;          // qualidade da abertura
  painDiscovery: number;    // capacidade de identificar dores
  solutionClarity: number;  // clareza na explicação da solução
  frameworkUsage: number;   // uso de frameworks de vendas
  advanceToDemo: number;    // efetividade em conduzir até a demo/agendamento
  rationale: string;        // justificativa curta da nota geral
}

// Frameworks de vendas detectados na conversa (SPIN/BANT/GPCT/MEDDIC/...).
export type SalesFramework = "SPIN" | "BANT" | "GPCT" | "MEDDIC" | "AIDA" | "Challenger" | "outro";

export interface FrameworkDetection {
  name: SalesFramework | string;
  detected: boolean;
  completeness: number;     // 0–100 — quanto do framework foi executado
  stepsCovered: string[];   // etapas executadas corretamente
  stepsMissed: string[];    // etapas ignoradas/mal executadas
  note: string;
}

// Por que converteu / por que não (Fase 3).
export interface OutcomeAnalysis {
  converted: boolean;       // reunião/demo agendada?
  conversionFactors: string[]; // fatores que contribuíram para o sucesso
  lossReasons: string[];       // motivos da não-conversão
  objections: ObjectionItem[]; // objeções identificadas
  improvements: string[];      // melhorias de abordagem para próximas calls
}

export interface ObjectionItem {
  objection: string;
  handled: boolean;
  note: string;
}

// ─── Qualificador de Garantia do Lead (Fase 4) ──────────────────────────────
// Origem COMERCIAL do lead (detectada pela IA) — distinta de contacts.source
// (que é a origem técnica de captura: linkedin/website/crm/garimpo...).
export type LeadOrigin = "inbound" | "outbound" | "referral" | "partner" | "other";
export type QualificationClassification = "qualified" | "partial" | "disqualified";

export interface QualificationScore {
  overall: number;            // 0–100 (aderência geral à solução)
  icpFit: number;             // aderência ao ICP
  pains: number;              // dores identificadas que a solução resolve
  buyingMoment: number;       // momento de compra
  financialPotential: number; // potencial financeiro / ticket
  decisionMaker: number;      // perfil decisor
  interest: number;           // interesse demonstrado nas interações
  rationale: string;
}

export interface LeadQualification {
  id: string;
  contactId: string;
  userId: string;
  teamId: string;
  origin: LeadOrigin;
  classification: QualificationClassification;
  score: QualificationScore;
  reasons: string[];          // motivos da classificação
  summary: string;            // veredito curto
  marketingNote: string | null; // sinal pro Marketing (segmentação/ICP/cargo/ticket/dor)
  status: ProcessingStatus;
  createdAt: string;
}

// ─── Desenvolvimento individual (Fase 5) ────────────────────────────────────
export interface MemberSkills {
  hardSkills: string[];   // ex.: "qualificação SPIN", "uso de CRM"
  softSkills: string[];   // ex.: "escuta ativa", "empatia"
  note: string | null;
  updatedAt: string | null;
}

// Evolução individual a partir dos scores de ligação (Fase 3) por critério.
export interface MemberDevelopment {
  skills: MemberSkills;
  callCount: number;
  avgScore: {
    overall: number;
    opening: number;
    painDiscovery: number;
    solutionClarity: number;
    frameworkUsage: number;
    advanceToDemo: number;
  } | null;
  trend: number | null;   // variação do overall vs período anterior (pontos)
  history: { date: string; overall: number; result: string | null }[];
  ai: { strengths: string[]; improvements: string[]; developmentNote: string } | null;
}

export interface CallDiagnosis {
  headline: string;
  sections: DiagnosisSection[];
  recommendations: string[];
}

export interface DiagnosisSection {
  title: string;
  body: string;
  severity: "info" | "warning" | "critical" | "positive";
  timestampMs?: number;
  originalQuote?: string;
  recommendedResponse?: string;
}

export interface KeyMoment {
  timestampMs: number;
  type: KeyMomentType;
  description: string;
  recommendation: string | null;
  sdrQuote: string | null;
  leadQuote: string | null;
}

export interface Message {
  id: string;
  userId: string;
  contactId: string;
  whatsappMessageId: string | null;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  audioUrl: string | null;
  transcription: string | null;
  sentAt: string;
  createdAt: string;
}

export interface CRMConnection {
  id: string;
  userId: string;
  provider: CRMProvider;
  expiresAt: string | null;
  pipelineId: string | null;
  fieldMappings: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppSession {
  id: string;
  userId: string;
  status: WhatsAppStatus;
  phoneNumber: string | null;
  connectedAt: string | null;
  updatedAt: string;
}

export interface ContentPiece {
  id: string;
  userId: string;
  contactId: string;
  type: ContentType;
  temperature: LeadTemperature;
  content: string;
  usedAt: string | null;
  createdAt: string;
}

export interface WeeklyReport {
  id: string;
  teamId: string;
  weekStart: string;
  weekEnd: string;
  reportData: WeeklyReportData;
  emailSentAt: string | null;
  createdAt: string;
}

export interface WeeklyReportData {
  thermometer: number;
  callsTotal: number;
  callsGoal: number;
  meetingsBooked: number;
  conversionRate: number;
  leadsEnriched: number;
  bottlenecks: Bottleneck[];
  memberDiagnoses: MemberDiagnosis[];
  actionItems: string[];
}

export interface Bottleneck {
  title: string;
  description: string;
  affectedMemberIds: string[];
  estimatedRevenueLoss: number;
  occurrenceCount: number;
}

export interface MemberDiagnosis {
  userId: string;
  userName: string;
  strengths: string[];
  criticalPoint: string;
  coachabilityScore: number;
  coachabilityStatus: "excellent" | "positive" | "alert" | "critical";
  coachabilityNote: string;
  weekGoal: string;
  // Fase 5 — desenvolvimento: foco de skills do gestor + progresso (scores de ligação).
  focusSkills?: string[];
  skillProgress?: string;
}

export interface FeedbackRecord {
  id: string;
  userId: string;
  managerId: string;
  callId: string;
  feedbackType: FeedbackType;
  feedbackText: string;
  targetMetric: string;
  baselineValue: number;
  createdAt: string;
}

// ─── API Request/Response shapes ────────────────────────────────────────────

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  inviteCode?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface EnrichRequest {
  firstName?:    string;
  lastName?:     string;
  linkedinUrl?:  string;
  companyName?:  string;
  companyDomain?: string;
  jobTitle?:     string;
  allDomains?:   string[];
  email?:        string;
  phone?:        string;
}

export interface ScrapeProcessosRequest {
  firstName: string;
  lastName:  string;
}

export interface ScrapeProcessosResponse {
  phones:         string[];
  companies:      string[];
  processesFound: number;
}

export interface CreateContactRequest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  companyName?: string;
  companyDomain?: string;
  jobTitle?: string;
  source: ContactSource;
  enrichmentData?: Partial<EnrichmentData>;
}

export interface GenerateContentRequest {
  contactId: string;
  type: ContentType;
  customContext?: string;
}

export interface CreateCallRequest {
  contactId: string;
  type: CallType;
  direction: CallDirection;
  startedAt: string;
}

export interface CompleteCallRequest {
  endedAt: string;
  durationSeconds: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
}

// ─── Extension ↔ Background messages ────────────────────────────────────────

export type ExtensionMessage =
  | { type: "ENRICH_CONTACT";           payload: EnrichRequest }
  | { type: "SCRAPE_PROCESSOS";         payload: ScrapeProcessosRequest }
  | { type: "SAVE_CONTACT";             payload: CreateContactRequest }
  | { type: "GET_AUTH_TOKEN" }
  | { type: "GENERATE_CONTENT";         payload: GenerateContentRequest }
  | { type: "CALL_STARTED";             payload: { contactId: string } }
  | { type: "CALL_ENDED";               payload: { callId: string; audioBlob?: string } }
  | { type: "LINKEDIN_PROFILE_STARTED"; payload: Pick<LinkedInProfileData, "linkedinUrl" | "firstName" | "lastName" | "headline" | "location"> }
  | { type: "LINKEDIN_PROFILE_DONE";    payload: LinkedInProfileData }
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "GET_TAB_CONTEXT" };

export type ExtensionResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Scraping payloads ────────────────────────────────────────────────────────

export interface LinkedInProfileData {
  linkedinUrl: string;
  firstName: string;
  lastName: string;
  headline: string | null;
  location: string | null;
  company: string | null;
  allDomains: string[];
  email: string | null;
  phone: string | null;
  twitter: string | null;
  website: string | null;
  emailCandidates: string[];
  emailConfidence: string | null;
}
