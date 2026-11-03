-- Fundação segura do SDR de voz: campanhas em rascunho, fila de contatos,
-- tentativas auditáveis e lista de supressão (não ligar).

DO $$ BEGIN
  CREATE TYPE voice_campaign_status AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE voice_campaign_contact_status AS ENUM ('pending', 'queued', 'contacted', 'converted', 'suppressed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE voice_attempt_status AS ENUM ('queued', 'dialing', 'in_progress', 'completed', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE voice_attempt_outcome AS ENUM ('no_answer', 'voicemail', 'gatekeeper', 'not_interested', 'callback', 'interested', 'meeting_booked', 'do_not_call', 'wrong_number', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS voice_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(200) NOT NULL,
  status voice_campaign_status NOT NULL DEFAULT 'draft',
  timezone varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
  business_hour_start integer NOT NULL DEFAULT 9 CHECK (business_hour_start BETWEEN 8 AND 17),
  business_hour_end integer NOT NULL DEFAULT 18 CHECK (business_hour_end BETWEEN 9 AND 20),
  daily_limit integer NOT NULL DEFAULT 10 CHECK (daily_limit BETWEEN 1 AND 50),
  max_attempts_per_lead integer NOT NULL DEFAULT 2 CHECK (max_attempts_per_lead BETWEEN 1 AND 3),
  min_retry_hours integer NOT NULL DEFAULT 48 CHECK (min_retry_hours BETWEEN 24 AND 720),
  provider_agent_id varchar(200),
  provider_phone_number_id varchar(200),
  ai_disclosure_required boolean NOT NULL DEFAULT true,
  recording_enabled boolean NOT NULL DEFAULT false,
  voice_rights_confirmed_at timestamp,
  compliance_confirmed_at timestamp,
  compliance_confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CHECK (business_hour_start < business_hour_end)
);

CREATE TABLE IF NOT EXISTS voice_campaign_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES voice_campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_snapshot varchar(30) NOT NULL,
  status voice_campaign_contact_status NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 0,
  attempts_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp,
  last_attempt_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT voice_campaign_contacts_uniq UNIQUE (campaign_id, contact_id)
);

CREATE TABLE IF NOT EXISTS voice_call_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES voice_campaigns(id) ON DELETE CASCADE,
  campaign_contact_id uuid NOT NULL REFERENCES voice_campaign_contacts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  call_id uuid REFERENCES calls(id) ON DELETE SET NULL,
  provider varchar(40) NOT NULL DEFAULT 'elevenlabs',
  provider_conversation_id varchar(200),
  phone varchar(30) NOT NULL,
  status voice_attempt_status NOT NULL DEFAULT 'queued',
  outcome voice_attempt_outcome,
  started_at timestamp,
  answered_at timestamp,
  ended_at timestamp,
  duration_seconds integer,
  transcript jsonb,
  summary text,
  provider_data jsonb,
  error_message text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT voice_call_attempts_conversation_uniq UNIQUE (provider_conversation_id)
);

CREATE TABLE IF NOT EXISTS voice_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  normalized_phone varchar(30) NOT NULL,
  reason varchar(80) NOT NULL DEFAULT 'do_not_call',
  source_attempt_id uuid REFERENCES voice_call_attempts(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT voice_suppressions_team_phone_uniq UNIQUE (team_id, normalized_phone)
);

CREATE TABLE IF NOT EXISTS voice_meeting_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES voice_campaigns(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES voice_call_attempts(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  requested_start_at timestamp NOT NULL,
  timezone varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
  invitee_email varchar(320),
  status varchar(30) NOT NULL DEFAULT 'requested',
  external_event_id varchar(200),
  scheduling_url text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT voice_meeting_requests_attempt_uniq UNIQUE (attempt_id)
);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  connected_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_email varchar(320) NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamp NOT NULL,
  scope text NOT NULL,
  calendar_id varchar(320) NOT NULL DEFAULT 'primary',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_connections_team_uniq UNIQUE (team_id)
);

CREATE INDEX IF NOT EXISTS voice_campaigns_team_idx ON voice_campaigns (team_id, created_at);
CREATE INDEX IF NOT EXISTS voice_campaigns_status_idx ON voice_campaigns (status);
CREATE INDEX IF NOT EXISTS voice_campaign_contacts_status_idx ON voice_campaign_contacts (campaign_id, status);
CREATE INDEX IF NOT EXISTS voice_campaign_contacts_next_idx ON voice_campaign_contacts (next_attempt_at);
CREATE INDEX IF NOT EXISTS voice_call_attempts_team_idx ON voice_call_attempts (team_id, created_at);
CREATE INDEX IF NOT EXISTS voice_call_attempts_campaign_idx ON voice_call_attempts (campaign_id, created_at);
CREATE INDEX IF NOT EXISTS voice_suppressions_team_idx ON voice_suppressions (team_id);
CREATE INDEX IF NOT EXISTS voice_meeting_requests_team_idx ON voice_meeting_requests (team_id, created_at);
CREATE INDEX IF NOT EXISTS google_calendar_connections_email_idx ON google_calendar_connections (account_email);
