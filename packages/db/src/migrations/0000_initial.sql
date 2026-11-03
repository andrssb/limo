-- Limo — Migration inicial
-- Gerada manualmente para o schema v0.1.0

CREATE TYPE "public"."user_role" AS ENUM('sdr', 'bdr', 'manager', 'admin');
CREATE TYPE "public"."lead_temperature" AS ENUM('cold', 'warm', 'hot');
CREATE TYPE "public"."contact_source" AS ENUM('linkedin', 'website', 'manual', 'crm', 'import');
CREATE TYPE "public"."call_type" AS ENUM('whatsapp', 'manual', 'imported');
CREATE TYPE "public"."call_direction" AS ENUM('inbound', 'outbound');
CREATE TYPE "public"."call_result" AS ENUM('positive', 'negative', 'neutral', 'inconclusive');
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'done', 'failed');
CREATE TYPE "public"."crm_provider" AS ENUM('hubspot', 'pipedrive', 'salesforce');
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound');
CREATE TYPE "public"."message_type" AS ENUM('text', 'audio', 'image', 'document');
CREATE TYPE "public"."whatsapp_status" AS ENUM('connecting', 'connected', 'disconnected');
CREATE TYPE "public"."content_type" AS ENUM('call_script', 'email', 'whatsapp');
CREATE TYPE "public"."feedback_type" AS ENUM('talk_ratio', 'objection_handling', 'discovery', 'closing', 'rapport');

CREATE TABLE "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(200) NOT NULL,
  "manager_id" uuid NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" varchar(320) NOT NULL,
  "name" varchar(200) NOT NULL,
  "password_hash" text NOT NULL,
  "role" "user_role" DEFAULT 'sdr' NOT NULL,
  "team_id" uuid,
  "avatar_url" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "team_id" uuid NOT NULL,
  "first_name" varchar(200) NOT NULL,
  "last_name" varchar(200) NOT NULL,
  "email" varchar(320),
  "phone" varchar(50),
  "linkedin_url" text,
  "company_name" varchar(300),
  "company_domain" varchar(300),
  "job_title" varchar(200),
  "location" varchar(300),
  "temperature" "lead_temperature" DEFAULT 'cold' NOT NULL,
  "source" "contact_source" NOT NULL,
  "crm_id" varchar(200),
  "crm_provider" "crm_provider",
  "enrichment_data" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "type" "call_type" NOT NULL,
  "direction" "call_direction" DEFAULT 'outbound' NOT NULL,
  "started_at" timestamp NOT NULL,
  "ended_at" timestamp,
  "duration_seconds" integer,
  "audio_url" text,
  "audio_size_bytes" integer,
  "transcription_status" "processing_status" DEFAULT 'pending' NOT NULL,
  "transcription_text" text,
  "transcription_segments" jsonb,
  "analysis_status" "processing_status" DEFAULT 'pending' NOT NULL,
  "result" "call_result",
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "call_analyses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "call_id" uuid NOT NULL,
  "result" "call_result" NOT NULL,
  "flash_summary" text NOT NULL,
  "diagnosis" jsonb NOT NULL,
  "next_step" text NOT NULL,
  "key_moments" jsonb DEFAULT '[]' NOT NULL,
  "talk_ratio" real NOT NULL,
  "sentiment_score" real NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "call_analyses_call_id_unique" UNIQUE("call_id")
);

CREATE TABLE "messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "whatsapp_message_id" varchar(200),
  "direction" "message_direction" NOT NULL,
  "type" "message_type" DEFAULT 'text' NOT NULL,
  "content" text,
  "audio_url" text,
  "transcription" text,
  "sent_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "messages_wa_id_uniq" UNIQUE("whatsapp_message_id")
);

CREATE TABLE "crm_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" "crm_provider" NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text,
  "expires_at" timestamp,
  "pipeline_id" varchar(200),
  "field_mappings" jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "crm_connections_user_id_provider_unique" UNIQUE("user_id","provider")
);

CREATE TABLE "whatsapp_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "status" "whatsapp_status" DEFAULT 'disconnected' NOT NULL,
  "session_data" jsonb,
  "phone_number" varchar(50),
  "connected_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_sessions_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE "content_pieces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "type" "content_type" NOT NULL,
  "temperature" "lead_temperature" NOT NULL,
  "content" text NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "weekly_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL,
  "week_start" timestamp NOT NULL,
  "week_end" timestamp NOT NULL,
  "report_data" jsonb NOT NULL,
  "email_sent_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "feedback_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "manager_id" uuid NOT NULL,
  "call_id" uuid,
  "feedback_type" "feedback_type" NOT NULL,
  "feedback_text" text NOT NULL,
  "target_metric" varchar(100) NOT NULL,
  "baseline_value" real NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Foreign keys
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE set null;

ALTER TABLE "contacts" ADD CONSTRAINT "contacts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;

ALTER TABLE "calls" ADD CONSTRAINT "calls_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;

ALTER TABLE "call_analyses" ADD CONSTRAINT "call_analyses_call_id_calls_id_fk"
  FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE cascade;

ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;

ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;

ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;

ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "content_pieces" ADD CONSTRAINT "content_pieces_contact_id_contacts_id_fk"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE cascade;

ALTER TABLE "weekly_reports" ADD CONSTRAINT "weekly_reports_team_id_teams_id_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE cascade;

ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_manager_id_users_id_fk"
  FOREIGN KEY ("manager_id") REFERENCES "users"("id");
ALTER TABLE "feedback_records" ADD CONSTRAINT "feedback_records_call_id_calls_id_fk"
  FOREIGN KEY ("call_id") REFERENCES "calls"("id") ON DELETE set null;

-- Indexes
CREATE INDEX "contacts_user_idx" ON "contacts" ("user_id");
CREATE INDEX "contacts_team_idx" ON "contacts" ("team_id");
CREATE INDEX "contacts_email_idx" ON "contacts" ("email");
CREATE INDEX "contacts_linkedin_idx" ON "contacts" ("linkedin_url");
CREATE INDEX "calls_user_idx" ON "calls" ("user_id");
CREATE INDEX "calls_contact_idx" ON "calls" ("contact_id");
CREATE INDEX "calls_started_at_idx" ON "calls" ("started_at");
CREATE INDEX "messages_contact_idx" ON "messages" ("contact_id");
CREATE INDEX "messages_sent_at_idx" ON "messages" ("sent_at");
CREATE INDEX "content_contact_idx" ON "content_pieces" ("contact_id");
CREATE INDEX "feedback_user_idx" ON "feedback_records" ("user_id");
