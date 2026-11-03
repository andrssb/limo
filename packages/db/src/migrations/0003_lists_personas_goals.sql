-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE garimpo_status AS ENUM ('pending','running','done','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE goal_period AS ENUM ('daily','weekly','monthly');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE goal_metric AS ENUM ('calls','contacts_added','meetings','deals');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE goal_status AS ENUM ('active','achieved','missed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add 'garimpo' to contact_source enum
ALTER TYPE contact_source ADD VALUE IF NOT EXISTS 'garimpo';

-- ─── Lists ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id             UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  enrichment_summary  TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lists_user_idx ON lists(user_id);
CREATE INDEX IF NOT EXISTS lists_team_idx ON lists(team_id);

CREATE TABLE IF NOT EXISTS list_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id     UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  added_by    UUID NOT NULL REFERENCES users(id),
  UNIQUE(list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS list_contacts_list_idx    ON list_contacts(list_id);
CREATE INDEX IF NOT EXISTS list_contacts_contact_idx ON list_contacts(contact_id);

-- ─── Personas ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS personas (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 VARCHAR(200) NOT NULL,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id              UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  target_roles         TEXT[] NOT NULL DEFAULT '{}',
  target_sectors       TEXT[] NOT NULL DEFAULT '{}',
  target_cnaes         TEXT[] NOT NULL DEFAULT '{}',
  target_states        TEXT[] NOT NULL DEFAULT '{}',
  target_cities        TEXT[] NOT NULL DEFAULT '{}',
  min_employees        INTEGER,
  max_employees        INTEGER,
  pain_point           TEXT NOT NULL DEFAULT '',
  product_description  TEXT NOT NULL DEFAULT '',
  created_at           TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS personas_user_idx ON personas(user_id);
CREATE INDEX IF NOT EXISTS personas_team_idx ON personas(team_id);

-- ─── Garimpo runs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS garimpo_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id        UUID NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
  list_id           UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            garimpo_status NOT NULL DEFAULT 'pending',
  contacts_found    INTEGER NOT NULL DEFAULT 0,
  companies_scanned INTEGER NOT NULL DEFAULT 0,
  log               TEXT[] NOT NULL DEFAULT '{}',
  started_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS garimpo_runs_persona_idx ON garimpo_runs(persona_id);
CREATE INDEX IF NOT EXISTS garimpo_runs_user_idx    ON garimpo_runs(user_id);
CREATE INDEX IF NOT EXISTS garimpo_runs_status_idx  ON garimpo_runs(status);

-- ─── Goals & Gamification ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id  UUID NOT NULL REFERENCES users(id),
  metric      goal_metric NOT NULL,
  target      INTEGER NOT NULL,
  period      goal_period NOT NULL,
  start_date  TIMESTAMP NOT NULL,
  end_date    TIMESTAMP NOT NULL,
  status      goal_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS goals_user_idx    ON goals(user_id);
CREATE INDEX IF NOT EXISTS goals_manager_idx ON goals(manager_id);

CREATE TABLE IF NOT EXISTS achievements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge        VARCHAR(100) NOT NULL,
  label        VARCHAR(200) NOT NULL,
  unlocked_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, badge)
);

CREATE INDEX IF NOT EXISTS achievements_user_idx ON achievements(user_id);
