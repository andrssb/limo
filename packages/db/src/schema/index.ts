import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  real,
  boolean,
  timestamp,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ──────────────────────────────────────────────────────────────────

export const teamPlanEnum  = pgEnum("team_plan",  ["trial", "start", "metrics", "business", "tester"]);
export const userRoleEnum  = pgEnum("user_role",  ["sdr", "bdr", "manager", "admin"]);
export const temperatureEnum = pgEnum("lead_temperature", ["cold", "warm", "hot"]);
export const contactSourceEnum = pgEnum("contact_source", ["linkedin", "website", "manual", "crm", "import", "garimpo"]);
export const callTypeEnum = pgEnum("call_type", ["whatsapp", "manual", "imported"]);
export const callDirectionEnum = pgEnum("call_direction", ["inbound", "outbound"]);
export const callResultEnum = pgEnum("call_result", ["positive", "negative", "neutral", "inconclusive"]);
export const processingStatusEnum = pgEnum("processing_status", ["pending", "processing", "done", "failed"]);
export const crmProviderEnum = pgEnum("crm_provider", ["hubspot", "pipedrive", "salesforce"]);
export const msgDirectionEnum = pgEnum("message_direction", ["inbound", "outbound"]);
export const msgTypeEnum = pgEnum("message_type", ["text", "audio", "image", "document"]);
export const waStatusEnum = pgEnum("whatsapp_status", ["connecting", "connected", "disconnected"]);
export const contentTypeEnum = pgEnum("content_type", ["call_script", "email", "whatsapp"]);
export const feedbackTypeEnum = pgEnum("feedback_type", [
  "talk_ratio",
  "objection_handling",
  "discovery",
  "closing",
  "rapport",
]);
export const garimpoStatusEnum   = pgEnum("garimpo_status",   ["pending", "running", "done", "failed"]);
export const materialStatusEnum  = pgEnum("material_status",  ["pending", "processing", "done", "failed"]);
export const materialTypeEnum    = pgEnum("material_type",    ["url", "text", "file"]);
export const goalPeriodEnum  = pgEnum("goal_period",  ["daily", "weekly", "monthly"]);
export const goalMetricEnum  = pgEnum("goal_metric",  ["calls", "contacts_added", "meetings", "deals"]);
export const goalStatusEnum  = pgEnum("goal_status",  ["active", "achieved", "missed"]);
export const voiceCampaignStatusEnum = pgEnum("voice_campaign_status", ["draft", "active", "paused", "completed", "archived"]);
export const voiceCampaignContactStatusEnum = pgEnum("voice_campaign_contact_status", ["pending", "queued", "contacted", "converted", "suppressed", "failed"]);
export const voiceAttemptStatusEnum = pgEnum("voice_attempt_status", ["queued", "dialing", "in_progress", "completed", "failed", "cancelled"]);
export const voiceAttemptOutcomeEnum = pgEnum("voice_attempt_outcome", [
  "no_answer",
  "voicemail",
  "gatekeeper",
  "not_interested",
  "callback",
  "interested",
  "meeting_booked",
  "do_not_call",
  "wrong_number",
  "failed",
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const teams = pgTable("teams", {
  id:          uuid("id").primaryKey().defaultRandom(),
  name:        varchar("name", { length: 200 }).notNull(),
  managerId:   uuid("manager_id").notNull(),
  plan:        teamPlanEnum("plan").notNull().default("trial"),
  assertivaEnabled: boolean("assertiva_enabled").notNull().default(true),
  voipApiKey:  text("voip_api_key"), // chave do webhook de VoIP (pré-integração universal)
  trialEndsAt: timestamp("trial_ends_at"),
  personasUsedCurrentPeriod: integer("personas_used_current_period").notNull().default(0),
  personasExtraBalance:      integer("personas_extra_balance").notNull().default(0),
  personasPeriodStartedAt:   timestamp("personas_period_started_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("sdr"),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    jobTitle: varchar("job_title", { length: 200 }),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({ emailUniq: unique().on(t.email) })
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    firstName: varchar("first_name", { length: 200 }).notNull(),
    lastName: varchar("last_name", { length: 200 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 50 }),
    linkedinUrl: text("linkedin_url"),
    companyName: varchar("company_name", { length: 300 }),
    companyDomain: varchar("company_domain", { length: 300 }),
    jobTitle: varchar("job_title", { length: 200 }),
    location: varchar("location", { length: 300 }),
    temperature: temperatureEnum("temperature").notNull().default("cold"),
    source: contactSourceEnum("source").notNull(),
    crmId: varchar("crm_id", { length: 200 }),
    crmProvider: crmProviderEnum("crm_provider"),
    enrichmentData: jsonb("enrichment_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("contacts_user_idx").on(t.userId),
    teamIdx: index("contacts_team_idx").on(t.teamId),
    emailIdx: index("contacts_email_idx").on(t.email),
    linkedinIdx: index("contacts_linkedin_idx").on(t.linkedinUrl),
  })
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Opcional: reunião de qualificação (ex.: Meet) pode não ter contato do CRM.
    contactId: uuid("contact_id")
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: callTypeEnum("type").notNull(),
    direction: callDirectionEnum("direction").notNull().default("outbound"),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at"),
    durationSeconds: integer("duration_seconds"),
    audioUrl: text("audio_url"),
    audioSizeBytes: integer("audio_size_bytes"),
    // Fase 0 — ingestão agnóstica ao canal. channel = de onde veio o áudio
    // (browser | voip | upload | whatsapp). sdrAudioUrl + leadAudioUrl = trilhas
    // separadas que habilitam diarização REAL; sourceMeta = metadados do VoIP.
    channel: text("channel"),
    sdrAudioUrl: text("sdr_audio_url"),
    leadAudioUrl: text("lead_audio_url"),
    sourceMeta: jsonb("source_meta"),
    transcriptionStatus: processingStatusEnum("transcription_status").notNull().default("pending"),
    transcriptionText: text("transcription_text"),
    transcriptionSegments: jsonb("transcription_segments"),
    analysisStatus: processingStatusEnum("analysis_status").notNull().default("pending"),
    result: callResultEnum("result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("calls_user_idx").on(t.userId),
    contactIdx: index("calls_contact_idx").on(t.contactId),
    startedAtIdx: index("calls_started_at_idx").on(t.startedAt),
  })
);

export const callAnalyses = pgTable("call_analyses", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id")
    .notNull()
    .unique()
    .references(() => calls.id, { onDelete: "cascade" }),
  result: callResultEnum("result").notNull(),
  flashSummary: text("flash_summary").notNull(),
  diagnosis: jsonb("diagnosis").notNull(),
  nextStep: text("next_step").notNull(),
  keyMoments: jsonb("key_moments").notNull().default([]),
  talkRatio: real("talk_ratio").notNull(),
  sentimentScore: real("sentiment_score").notNull(),
  // Fase 3 — score detalhado, frameworks detectados e análise de conversão/perda.
  score: jsonb("score"),
  frameworks: jsonb("frameworks"),
  outcome: jsonb("outcome"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// SDR de voz. A primeira versão é deliberadamente passiva: prepara campanhas e
// recebe webhooks, mas não contém worker de discagem. A ativação externa fica
// protegida por VOICE_SDR_ENABLED e será adicionada depois do piloto humano.
export const voiceCampaigns = pgTable(
  "voice_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 200 }).notNull(),
    status: voiceCampaignStatusEnum("status").notNull().default("draft"),
    timezone: varchar("timezone", { length: 80 }).notNull().default("America/Sao_Paulo"),
    businessHourStart: integer("business_hour_start").notNull().default(9),
    businessHourEnd: integer("business_hour_end").notNull().default(18),
    dailyLimit: integer("daily_limit").notNull().default(10),
    maxAttemptsPerLead: integer("max_attempts_per_lead").notNull().default(2),
    minRetryHours: integer("min_retry_hours").notNull().default(48),
    providerAgentId: varchar("provider_agent_id", { length: 200 }),
    providerPhoneNumberId: varchar("provider_phone_number_id", { length: 200 }),
    aiDisclosureRequired: boolean("ai_disclosure_required").notNull().default(true),
    recordingEnabled: boolean("recording_enabled").notNull().default(false),
    voiceRightsConfirmedAt: timestamp("voice_rights_confirmed_at"),
    complianceConfirmedAt: timestamp("compliance_confirmed_at"),
    complianceConfirmedBy: uuid("compliance_confirmed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("voice_campaigns_team_idx").on(t.teamId, t.createdAt),
    statusIdx: index("voice_campaigns_status_idx").on(t.status),
  })
);

export const voiceCampaignContacts = pgTable(
  "voice_campaign_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").notNull().references(() => voiceCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    phoneSnapshot: varchar("phone_snapshot", { length: 30 }).notNull(),
    status: voiceCampaignContactStatusEnum("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(0),
    attemptsCount: integer("attempts_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    campaignContactUniq: unique("voice_campaign_contacts_uniq").on(t.campaignId, t.contactId),
    campaignStatusIdx: index("voice_campaign_contacts_status_idx").on(t.campaignId, t.status),
    nextAttemptIdx: index("voice_campaign_contacts_next_idx").on(t.nextAttemptAt),
  })
);

export const voiceCallAttempts = pgTable(
  "voice_call_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => voiceCampaigns.id, { onDelete: "cascade" }),
    campaignContactId: uuid("campaign_contact_id").notNull().references(() => voiceCampaignContacts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    provider: varchar("provider", { length: 40 }).notNull().default("elevenlabs"),
    providerConversationId: varchar("provider_conversation_id", { length: 200 }),
    phone: varchar("phone", { length: 30 }).notNull(),
    status: voiceAttemptStatusEnum("status").notNull().default("queued"),
    outcome: voiceAttemptOutcomeEnum("outcome"),
    startedAt: timestamp("started_at"),
    answeredAt: timestamp("answered_at"),
    endedAt: timestamp("ended_at"),
    durationSeconds: integer("duration_seconds"),
    transcript: jsonb("transcript"),
    summary: text("summary"),
    providerData: jsonb("provider_data"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("voice_call_attempts_team_idx").on(t.teamId, t.createdAt),
    campaignIdx: index("voice_call_attempts_campaign_idx").on(t.campaignId, t.createdAt),
    conversationUniq: unique("voice_call_attempts_conversation_uniq").on(t.providerConversationId),
  })
);

export const voiceSuppressions = pgTable(
  "voice_suppressions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    normalizedPhone: varchar("normalized_phone", { length: 30 }).notNull(),
    reason: varchar("reason", { length: 80 }).notNull().default("do_not_call"),
    sourceAttemptId: uuid("source_attempt_id").references(() => voiceCallAttempts.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamPhoneUniq: unique("voice_suppressions_team_phone_uniq").on(t.teamId, t.normalizedPhone),
    teamIdx: index("voice_suppressions_team_idx").on(t.teamId),
  })
);

export const voiceMeetingRequests = pgTable(
  "voice_meeting_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => voiceCampaigns.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id").notNull().references(() => voiceCallAttempts.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    requestedStartAt: timestamp("requested_start_at").notNull(),
    timezone: varchar("timezone", { length: 80 }).notNull().default("America/Sao_Paulo"),
    inviteeEmail: varchar("invitee_email", { length: 320 }),
    status: varchar("status", { length: 30 }).notNull().default("requested"),
    externalEventId: varchar("external_event_id", { length: 200 }),
    schedulingUrl: text("scheduling_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    attemptUniq: unique("voice_meeting_requests_attempt_uniq").on(t.attemptId),
    teamIdx: index("voice_meeting_requests_team_idx").on(t.teamId, t.createdAt),
  })
);

export const googleCalendarConnections = pgTable(
  "google_calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    connectedBy: uuid("connected_by").notNull().references(() => users.id, { onDelete: "restrict" }),
    accountEmail: varchar("account_email", { length: 320 }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    scope: text("scope").notNull(),
    calendarId: varchar("calendar_id", { length: 320 }).notNull().default("primary"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    teamUniq: unique("google_calendar_connections_team_uniq").on(t.teamId),
    emailIdx: index("google_calendar_connections_email_idx").on(t.accountEmail),
  })
);

// Fase 4 — Qualificador de Garantia do Lead (manager/admin).
export const leadQualifications = pgTable(
  "lead_qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    origin: text("origin").notNull().default("other"),
    classification: text("classification").notNull(),
    score: jsonb("score").notNull(),
    reasons: jsonb("reasons").notNull().default([]),
    summary: text("summary").notNull(),
    marketingNote: text("marketing_note"),
    status: processingStatusEnum("status").notNull().default("done"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index("lead_qual_contact_idx").on(t.contactId),
    teamIdx: index("lead_qual_team_idx").on(t.teamId, t.createdAt),
  })
);

// Fase 5 — hard/soft skills definidas pelo gestor por membro (1 linha por user).
export const memberSkills = pgTable(
  "member_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    hardSkills: jsonb("hard_skills").notNull().default([]),
    softSkills: jsonb("soft_skills").notNull().default([]),
    note: text("note"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: unique("member_skills_user_uniq").on(t.userId),
    teamIdx: index("member_skills_team_idx").on(t.teamId),
  })
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    whatsappMessageId: varchar("whatsapp_message_id", { length: 200 }),
    direction: msgDirectionEnum("direction").notNull(),
    type: msgTypeEnum("type").notNull().default("text"),
    content: text("content"),
    audioUrl: text("audio_url"),
    transcription: text("transcription"),
    sentAt: timestamp("sent_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index("messages_contact_idx").on(t.contactId),
    waIdUniq: unique("messages_wa_id_uniq").on(t.whatsappMessageId),
    sentAtIdx: index("messages_sent_at_idx").on(t.sentAt),
  })
);

export const crmConnections = pgTable(
  "crm_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: crmProviderEnum("provider").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    pipelineId: varchar("pipeline_id", { length: 200 }),
    fieldMappings: jsonb("field_mappings").notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userProviderUniq: unique().on(t.userId, t.provider),
  })
);

export const whatsappSessions = pgTable("whatsapp_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  status: waStatusEnum("status").notNull().default("disconnected"),
  sessionData: jsonb("session_data"),
  phoneNumber: varchar("phone_number", { length: 50 }),
  connectedAt: timestamp("connected_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const contentPieces = pgTable(
  "content_pieces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    type: contentTypeEnum("type").notNull(),
    temperature: temperatureEnum("temperature").notNull(),
    content: text("content").notNull(),
    usedAt: timestamp("used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    contactIdx: index("content_contact_idx").on(t.contactId),
  })
);

export const weeklyReports = pgTable("weekly_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  teamId: uuid("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  weekStart: timestamp("week_start").notNull(),
  weekEnd: timestamp("week_end").notNull(),
  reportData: jsonb("report_data").notNull(),
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 12 }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: unique("team_invites_code_uniq").on(t.code),
    teamIdx: index("invites_team_idx").on(t.teamId),
  })
);

export const feedbackRecords = pgTable(
  "feedback_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => users.id),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    feedbackType: feedbackTypeEnum("feedback_type").notNull(),
    feedbackText: text("feedback_text").notNull(),
    targetMetric: varchar("target_metric", { length: 100 }).notNull(),
    baselineValue: real("baseline_value").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("feedback_user_idx").on(t.userId),
  })
);

export const enrichmentPool = pgTable(
  "enrichment_pool",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    linkedinUrl:     text("linkedin_url").unique(),
    fullName:        varchar("full_name", { length: 300 }),
    companyDomain:   varchar("company_domain", { length: 300 }),
    email:           varchar("email", { length: 320 }),
    emailConfidence: varchar("email_confidence", { length: 20 }).default("guessed"),
    emailsFound:     text("emails_found").array().notNull().default([]),
    phonesFound:     text("phones_found").array().notNull().default([]),
    processesFound:  integer("processes_found").notNull().default(0),
    sources:         text("sources").array().notNull().default([]),
    rawData:         jsonb("raw_data").notNull().default({}),
    lastEnrichedAt:  timestamp("last_enriched_at").notNull().defaultNow(),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameIdx:   index("enrichment_pool_name_idx").on(t.fullName),
    domainIdx: index("enrichment_pool_domain_idx").on(t.companyDomain),
    emailIdx:  index("enrichment_pool_email_idx").on(t.email),
  })
);

// ─── Product Education ────────────────────────────────────────────────────────

export const productMaterials = pgTable(
  "product_materials",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    userId:     uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId:     uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    type:       materialTypeEnum("type").notNull().default("url"),
    title:      varchar("title", { length: 500 }),
    sourceUrl:  text("source_url"),
    rawContent: text("raw_content"),
    aiSummary:  text("ai_summary"),
    status:     materialStatusEnum("status").notNull().default("pending"),
    createdAt:  timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("product_materials_team_idx").on(t.teamId),
    userIdx: index("product_materials_user_idx").on(t.userId),
  })
);

// ─── Sales Playbook (Discurso) ────────────────────────────────────────────────

export const salesReferences = pgTable(
  "sales_references",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    teamId:          uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    name:            varchar("name", { length: 200 }).notNull(),
    youtubeChannel:  varchar("youtube_channel", { length: 200 }),
    youtubeHandle:   varchar("youtube_handle", { length: 100 }),
    instagramHandle: varchar("instagram_handle", { length: 100 }),
    specialty:       text("specialty"),
    lastEnrichedAt:  timestamp("last_enriched_at"),
    isActive:        boolean("is_active").notNull().default(true),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("sales_references_team_idx").on(t.teamId),
  })
);

export const salesInsights = pgTable(
  "sales_insights",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    teamId:      uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").references(() => salesReferences.id, { onDelete: "set null" }),
    category:    varchar("category", { length: 100 }),
    title:       varchar("title", { length: 300 }),
    insight:     text("insight").notNull(),
    sourceUrl:   text("source_url"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx:     index("sales_insights_team_idx").on(t.teamId),
    categoryIdx: index("sales_insights_category_idx").on(t.category),
  })
);

// ─── Coaching Sessions ────────────────────────────────────────────────────────

export const coachingSessions = pgTable(
  "coaching_sessions",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    userId:         uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId:         uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    contactId:      uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    status:         varchar("status", { length: 20 }).notNull().default("active"),
    fullTranscript: text("full_transcript").notNull().default(""),
    tips:           jsonb("tips").notNull().default([]),
    startedAt:      timestamp("started_at").notNull().defaultNow(),
    endedAt:        timestamp("ended_at"),
  },
  (t) => ({
    userIdx: index("coaching_sessions_user_idx").on(t.userId),
    teamIdx: index("coaching_sessions_team_idx").on(t.teamId),
  })
);

// ─── Lists ────────────────────────────────────────────────────────────────────

export const lists = pgTable(
  "lists",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    name:        varchar("name", { length: 200 }).notNull(),
    description: text("description"),
    userId:      uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId:      uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    enrichmentSummary: text("enrichment_summary"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
    updatedAt:   timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("lists_user_idx").on(t.userId),
    teamIdx: index("lists_team_idx").on(t.teamId),
  })
);

export const listContacts = pgTable(
  "list_contacts",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    listId:    uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    addedAt:   timestamp("added_at").notNull().defaultNow(),
    addedBy:   uuid("added_by").notNull().references(() => users.id),
  },
  (t) => ({
    listIdx:    index("list_contacts_list_idx").on(t.listId),
    contactIdx: index("list_contacts_contact_idx").on(t.contactId),
    uniq:       unique("list_contacts_uniq").on(t.listId, t.contactId),
  })
);

// ─── List companies (base discovered via "Descobrir", worked by the Garimpo) ──

export const listCompanies = pgTable(
  "list_companies",
  {
    id:           uuid("id").primaryKey().defaultRandom(),
    listId:       uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    discCompanyId: uuid("disc_company_id"),   // disc_companies.id when RF-sourced (no FK: optional)
    cnpj:         varchar("cnpj", { length: 14 }),
    legalName:    varchar("legal_name", { length: 300 }).notNull(),
    tradeName:    varchar("trade_name", { length: 300 }),
    state:        varchar("state", { length: 2 }),
    city:         varchar("city", { length: 150 }),
    domain:       varchar("domain", { length: 300 }),
    sector:       varchar("sector", { length: 150 }),
    publicEmail:  varchar("public_email", { length: 320 }),
    publicPhone:  varchar("public_phone", { length: 50 }),
    addedAt:      timestamp("added_at").notNull().defaultNow(),
    addedBy:      uuid("added_by").notNull().references(() => users.id),
  },
  (t) => ({
    listIdx:  index("list_companies_list_idx").on(t.listId),
    cnpjUniq: unique("list_companies_list_cnpj_uniq").on(t.listId, t.cnpj),
  })
);

// ─── Personas ────────────────────────────────────────────────────────────────

export const personas = pgTable(
  "personas",
  {
    id:                 uuid("id").primaryKey().defaultRandom(),
    name:               varchar("name", { length: 200 }).notNull(),
    userId:             uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    teamId:             uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    targetRoles:        text("target_roles").array().notNull().default([]),
    targetSectors:      text("target_sectors").array().notNull().default([]),
    targetCnaes:        text("target_cnaes").array().notNull().default([]),
    targetStates:       text("target_states").array().notNull().default([]),
    targetCities:       text("target_cities").array().notNull().default([]),
    minEmployees:       integer("min_employees"),
    maxEmployees:       integer("max_employees"),
    painPoint:          text("pain_point").notNull().default(""),
    productDescription: text("product_description").notNull().default(""),
    createdAt:          timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("personas_user_idx").on(t.userId),
    teamIdx: index("personas_team_idx").on(t.teamId),
  })
);

// ─── Garimpo runs ─────────────────────────────────────────────────────────────

export const garimpoRuns = pgTable(
  "garimpo_runs",
  {
    id:             uuid("id").primaryKey().defaultRandom(),
    personaId:      uuid("persona_id").notNull().references(() => personas.id, { onDelete: "cascade" }),
    listId:         uuid("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    userId:         uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status:         garimpoStatusEnum("status").notNull().default("pending"),
    contactsFound:  integer("contacts_found").notNull().default(0),
    companiesScanned: integer("companies_scanned").notNull().default(0),
    log:            text("log").array().notNull().default([]),
    startedAt:      timestamp("started_at").notNull().defaultNow(),
    completedAt:    timestamp("completed_at"),
  },
  (t) => ({
    personaIdx: index("garimpo_runs_persona_idx").on(t.personaId),
    userIdx:    index("garimpo_runs_user_idx").on(t.userId),
    statusIdx:  index("garimpo_runs_status_idx").on(t.status),
  })
);

// ─── Goals & Gamification ─────────────────────────────────────────────────────

export const goals = pgTable(
  "goals",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    userId:    uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    managerId: uuid("manager_id").notNull().references(() => users.id),
    metric:    goalMetricEnum("metric").notNull(),
    target:    integer("target").notNull(),
    period:    goalPeriodEnum("period").notNull(),
    startDate: timestamp("start_date").notNull(),
    endDate:   timestamp("end_date").notNull(),
    status:    goalStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx:    index("goals_user_idx").on(t.userId),
    managerIdx: index("goals_manager_idx").on(t.managerId),
  })
);

// ─── Coaching Knowledge (enrichment materials for the coaching AI) ────────────

export const coachingKnowledge = pgTable(
  "coaching_knowledge",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    teamId:      uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId:      uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type:        varchar("type", { length: 20 }).notNull().default("url"), // url | text | youtube
    title:       varchar("title", { length: 500 }),
    sourceUrl:   text("source_url"),
    rawContent:  text("raw_content"),
    aiSummary:   text("ai_summary"),
    status:      varchar("status", { length: 20 }).notNull().default("pending"),
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("coaching_knowledge_team_idx").on(t.teamId),
  })
);

// ─── Enrichment Engine ────────────────────────────────────────────────────────

export const enrCompanies = pgTable(
  "enr_companies",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    name:            varchar("name", { length: 300 }).notNull(),
    tradeName:       varchar("trade_name", { length: 300 }),
    legalName:       varchar("legal_name", { length: 300 }),
    cnpj:            varchar("cnpj", { length: 18 }).unique(),
    sector:          varchar("sector", { length: 200 }),
    state:           varchar("state", { length: 2 }),
    city:            varchar("city", { length: 200 }),
    employeeRange:   varchar("employee_range", { length: 20 }),
    confidenceScore: integer("confidence_score").notNull().default(0),
    lastEnrichedAt:  timestamp("last_enriched_at").notNull().defaultNow(),
    lastEnginePass:  timestamp("last_engine_pass"),   // quando o motor passivo varreu (null = nunca)
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameIdx:    index("enr_companies_name_idx").on(t.name),
    sectorIdx:  index("enr_companies_sector_idx").on(t.sector),
    stateIdx:   index("enr_companies_state_idx").on(t.state),
    statePass:  index("enr_companies_state_pass_idx").on(t.state, t.lastEnginePass),
  })
);

// Cache + auditoria de enriquecimentos pagos ("Enriquecer Contato").
export const paidEnrichments = pgTable(
  "paid_enrichments",
  {
    id:        uuid("id").primaryKey().defaultRandom(),
    teamId:    uuid("team_id").notNull(),
    contactId: uuid("contact_id"),
    cacheKey:  varchar("cache_key", { length: 200 }).notNull(),
    provider:  varchar("provider", { length: 50 }).notNull(),
    matched:   boolean("matched").notNull().default(false),
    result:    jsonb("result"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => ({
    cacheIdx: index("paid_enrich_cache_idx").on(t.cacheKey, t.expiresAt),
    teamIdx:  index("paid_enrich_team_idx").on(t.teamId, t.createdAt),
  })
);

export const enrDomains = pgTable(
  "enr_domains",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    companyId:       uuid("company_id").notNull().references(() => enrCompanies.id, { onDelete: "cascade" }),
    domain:          varchar("domain", { length: 300 }).notNull(),
    isOfficial:      boolean("is_official").notNull().default(false),
    confidenceScore: integer("confidence_score").notNull().default(0),
    source:          varchar("source", { length: 100 }),
    verifiedAt:      timestamp("verified_at"),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("enr_domains_company_idx").on(t.companyId),
    domainIdx:  index("enr_domains_domain_idx").on(t.domain),
    uniq:       unique("enr_domains_uniq").on(t.companyId, t.domain),
  })
);

export const enrEmailPatterns = pgTable(
  "enr_email_patterns",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    domain:          varchar("domain", { length: 300 }).notNull().unique(),
    pattern:         varchar("pattern", { length: 100 }).notNull(),
    mxProvider:      varchar("mx_provider", { length: 100 }),
    examples:        text("examples").array().notNull().default([]),
    confidenceScore: integer("confidence_score").notNull().default(0),
    sampleCount:     integer("sample_count").notNull().default(1),
    lastValidatedAt: timestamp("last_validated_at"),
    createdAt:       timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    domainIdx: index("enr_email_patterns_domain_idx").on(t.domain),
  })
);

export const enrSources = pgTable(
  "enr_sources",
  {
    id:              uuid("id").primaryKey().defaultRandom(),
    entityType:      varchar("entity_type", { length: 50 }).notNull(),
    entityId:        uuid("entity_id").notNull(),
    fieldName:       varchar("field_name", { length: 100 }).notNull(),
    fieldValue:      text("field_value").notNull(),
    sourceType:      varchar("source_type", { length: 100 }).notNull(),
    sourcePriority:  integer("source_priority"),
    sourceUrl:       text("source_url"),
    snippet:         text("snippet"),
    personId:        uuid("person_id"),
    companyId:       uuid("company_id"),
    phoneKind:       varchar("phone_kind", { length: 40 }),
    confidenceScore: integer("confidence_score").notNull().default(0),
    collectedAt:     timestamp("collected_at").notNull().defaultNow(),
    validatedAt:     timestamp("validated_at"),
    isValid:         boolean("is_valid"),
  },
  (t) => ({
    entityIdx:    index("enr_sources_entity_idx").on(t.entityType, t.entityId),
    fieldIdx:     index("enr_sources_field_idx").on(t.fieldName),
    typeIdx:      index("enr_sources_type_idx").on(t.sourceType),
    collectedIdx: index("enr_sources_collected_idx").on(t.collectedAt),
    personIdx:    index("enr_sources_person_idx").on(t.personId),
    companyIdx:   index("enr_sources_company_idx").on(t.companyId),
  })
);

export const achievements = pgTable(
  "achievements",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    userId:     uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    badge:      varchar("badge", { length: 100 }).notNull(),
    label:      varchar("label", { length: 200 }).notNull(),
    unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("achievements_user_idx").on(t.userId),
    uniq:    unique("achievements_user_badge_uniq").on(t.userId, t.badge),
  })
);

// ─── Passive enrichment engine runs ──────────────────────────────────────────

export const enrRuns = pgTable(
  "enr_runs",
  {
    id:                   uuid("id").primaryKey().defaultRandom(),
    triggeredBy:          varchar("triggered_by", { length: 20 }).notNull(), // 'cron' | 'manual'
    triggeredByUserId:    uuid("triggered_by_user_id"),
    status:               varchar("status", { length: 20 }).notNull().default("running"),
    startedAt:            timestamp("started_at").notNull().defaultNow(),
    completedAt:          timestamp("completed_at"),
    durationSeconds:      integer("duration_seconds"),
    companiesProcessed:   integer("companies_processed").notNull().default(0),
    peopleFound:          integer("people_found").notNull().default(0),
    jobTitlesIdentified:  integer("job_titles_identified").notNull().default(0),
    linkedinUrlsFound:    integer("linkedin_urls_found").notNull().default(0),
    emailsInferred:       integer("emails_inferred").notNull().default(0),
    phonesFound:          integer("phones_found").notNull().default(0),
    recordsSaved:         integer("records_saved").notNull().default(0),
    errorsCount:          integer("errors_count").notNull().default(0),
    log:                  text("log").array().notNull().default([]),
  },
  (t) => ({
    startedIdx: index("enr_runs_started_idx").on(t.startedAt),
    statusIdx:  index("enr_runs_status_idx").on(t.status),
  })
);

// ─── Signup survey (mini-typeform do cadastro) ────────────────────────────────

export const signupSurveys = pgTable(
  "signup_surveys",
  {
    id:          uuid("id").primaryKey().defaultRandom(),
    fullName:    varchar("full_name", { length: 200 }).notNull(),
    company:     varchar("company", { length: 200 }),
    website:     varchar("website", { length: 300 }),
    email:       varchar("email", { length: 320 }).notNull(),
    phone:       varchar("phone", { length: 50 }),
    accessType:  varchar("access_type", { length: 20 }).notNull(), // 'individual' | 'team'
    topFeature:  varchar("top_feature", { length: 100 }),
    teamHasLimo: boolean("team_has_limo"),
    peopleCount: integer("people_count"),
    peopleRoles: text("people_roles"),
    buyerRole:   varchar("buyer_role", { length: 200 }),
    outcome:     varchar("outcome", { length: 30 }), // 'account' | 'ask_invite' | 'demo'
    createdAt:   timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    emailIdx:   index("signup_surveys_email_idx").on(t.email),
    createdIdx: index("signup_surveys_created_idx").on(t.createdAt),
  })
);

// ─── Telemetria mínima da extensão (anônima, sem PII) ─────────────────────────
// Mede o meio do funil: instalou → abriu (app_open) → viu login (login_view) →
// tentou logar (login_attempt, com ok). Identificada só por um id anônimo
// gerado na instalação. Best-effort: o ping nunca bloqueia a UI da extensão.

export const extensionEvents = pgTable(
  "extension_events",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    type:       varchar("type", { length: 40 }).notNull(),    // 'install' | 'app_open' | 'login_view' | 'login_attempt'
    anonId:     varchar("anon_id", { length: 64 }).notNull(), // id anônimo gerado na instalação
    ok:         boolean("ok"),                                 // só p/ login_attempt: sucesso?
    extVersion: varchar("ext_version", { length: 20 }),        // versão da extensão
    createdAt:  timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    typeIdx:    index("extension_events_type_idx").on(t.type),
    createdIdx: index("extension_events_created_idx").on(t.createdAt),
    anonIdx:    index("extension_events_anon_idx").on(t.anonId),
  })
);

// ─── Relations ───────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ one, many }) => ({
  team: one(teams, { fields: [users.teamId], references: [teams.id] }),
  contacts: many(contacts),
  calls: many(calls),
  messages: many(messages),
  crmConnections: many(crmConnections),
  whatsappSession: one(whatsappSessions, { fields: [users.id], references: [whatsappSessions.userId] }),
  contentPieces: many(contentPieces),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  manager: one(users, { fields: [teams.managerId], references: [users.id] }),
  members: many(users),
  contacts: many(contacts),
  weeklyReports: many(weeklyReports),
}));

// ─── Apollo People Cache ──────────────────────────────────────────────────────

export const enrPeople = pgTable(
  "enr_people",
  {
    id:            uuid("id").primaryKey().defaultRandom(),
    fullName:      varchar("full_name",      { length: 300 }).notNull(),
    firstName:     varchar("first_name",     { length: 150 }),
    lastName:      varchar("last_name",      { length: 150 }),
    jobTitle:      text("job_title"),
    seniority:     varchar("seniority",      { length: 50 }),
    companyName:   varchar("company_name",   { length: 300 }),
    companyNameNorm: varchar("company_name_norm", { length: 300 }),  // normalized for joining with garimpo companies
    cnpj:          varchar("cnpj",            { length: 14 }),         // digits-only — strongest join key with disc_companies
    companyDomain: varchar("company_domain", { length: 300 }),
    linkedinUrl:   text("linkedin_url"),
    email:         varchar("email",          { length: 320 }),
    emailStatus:   varchar("email_status",   { length: 30 }),
    phone:         varchar("phone",          { length: 50 }),
    city:          varchar("city",           { length: 150 }),
    state:         varchar("state",          { length: 100 }),
    country:       varchar("country",        { length: 100 }).default("Brazil"),
    source:        varchar("source",         { length: 30 }).notNull().default("apollo"),
    rawData:       jsonb("raw_data").notNull().default({}),
    cachedAt:      timestamp("cached_at").notNull().defaultNow(),
    expiresAt:     timestamp("expires_at").notNull().defaultNow(),
  },
  (t) => ({
    linkedinIdx:    index("enr_people_linkedin_idx").on(t.linkedinUrl),
    domainTitleIdx: index("enr_people_domain_title_idx").on(t.companyDomain, t.jobTitle),
    nameDomainIdx:  index("enr_people_name_domain_idx").on(t.fullName, t.companyDomain),
    nameNormIdx:    index("enr_people_name_norm_idx").on(t.companyNameNorm),
    cnpjIdx:        index("enr_people_cnpj_idx").on(t.cnpj),
  })
);

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  user: one(users, { fields: [contacts.userId], references: [users.id] }),
  team: one(teams, { fields: [contacts.teamId], references: [teams.id] }),
  calls: many(calls),
  messages: many(messages),
  contentPieces: many(contentPieces),
}));

export const callsRelations = relations(calls, ({ one }) => ({
  user: one(users, { fields: [calls.userId], references: [users.id] }),
  contact: one(contacts, { fields: [calls.contactId], references: [contacts.id] }),
  analysis: one(callAnalyses, { fields: [calls.id], references: [callAnalyses.callId] }),
}));

export const callAnalysesRelations = relations(callAnalyses, ({ one }) => ({
  call: one(calls, { fields: [callAnalyses.callId], references: [calls.id] }),
}));

// ─── Lia (assistente de SDR do Limo) ─────────────────────────────────────────
// Estado do motor de cadência da Lia, persistido no banco (antes era um .xlsx
// local). O motor roda LOCAL; estas tabelas só guardam o estado pro painel
// nativo (manager-only) ler. IDs são bigserial (bigint) porque o motor em
// Python referencia o lead por inteiro sequencial. Ver migration 0036.

export const liaLeads = pgTable(
  "lia_leads",
  {
    id:               integer("id").primaryKey(),  // bigserial no banco; gerado pelo Postgres
    teamId:           uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    nome:             text("nome").notNull().default(""),
    empresa:          text("empresa").notNull().default(""),
    numFuncionarios:  integer("num_funcionarios"),
    cargo:            text("cargo").notNull().default(""),
    email:            text("email").notNull().default(""),
    whatsapp:         text("whatsapp").notNull().default(""),
    origem:           text("origem").notNull().default(""),
    linkCrm:          text("link_crm").notNull().default(""),
    etapa:            text("etapa").notNull().default("Novo"),
    diaCadencia:      integer("dia_cadencia").notNull().default(0),
    proximaAcao:      timestamp("proxima_acao", { mode: "date" }),
    ultimoToque:      timestamp("ultimo_toque", { mode: "date" }),
    canalUltimoToque: text("canal_ultimo_toque"),
    respondeu:        boolean("respondeu").notNull().default(false),
    objecao:          text("objecao").notNull().default(""),
    closer:           text("closer").notNull().default(""),
    dataReuniao:      timestamp("data_reuniao", { mode: "date" }),
    observacoes:      text("observacoes").notNull().default(""),
    motivoPerdido:    text("motivo_perdido").notNull().default(""),
    createdAt:        timestamp("created_at").notNull().defaultNow(),
    updatedAt:        timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    teamIdx:  index("lia_leads_team_idx").on(t.teamId),
    etapaIdx: index("lia_leads_etapa_idx").on(t.etapa),
  })
);

export const liaEvents = pgTable(
  "lia_events",
  {
    id:         integer("id").primaryKey(),  // bigserial no banco
    leadId:     integer("lead_id").references(() => liaLeads.id, { onDelete: "cascade" }),
    teamId:     uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
    tipo:       text("tipo").notNull(),
    canal:      text("canal"),
    variante:   text("variante").notNull().default(""),
    resultado:  text("resultado").notNull().default(""),
    objecao:    text("objecao").notNull().default(""),
    detalhe:    text("detalhe").notNull().default(""),
    createdAt:  timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index("lia_events_lead_idx").on(t.leadId),
    teamIdx: index("lia_events_team_idx").on(t.teamId),
    whenIdx: index("lia_events_when_idx").on(t.occurredAt),
  })
);

export const liaLeadsRelations = relations(liaLeads, ({ one, many }) => ({
  team: one(teams, { fields: [liaLeads.teamId], references: [teams.id] }),
  events: many(liaEvents),
}));

export const liaEventsRelations = relations(liaEvents, ({ one }) => ({
  lead: one(liaLeads, { fields: [liaEvents.leadId], references: [liaLeads.id] }),
}));
