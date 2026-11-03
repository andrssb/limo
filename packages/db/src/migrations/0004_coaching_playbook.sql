-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE material_status AS ENUM ('pending','processing','done','failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE material_type AS ENUM ('url','text','file');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Product Education ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_materials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id      UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  type         material_type NOT NULL DEFAULT 'url',
  title        VARCHAR(500),
  source_url   TEXT,
  raw_content  TEXT,
  ai_summary   TEXT,
  status       material_status NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_materials_team_idx ON product_materials(team_id);
CREATE INDEX IF NOT EXISTS product_materials_user_idx ON product_materials(user_id);

-- ─── Sales Playbook ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sales_references (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id           UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name              VARCHAR(200) NOT NULL,
  youtube_channel   VARCHAR(200),
  youtube_handle    VARCHAR(100),
  instagram_handle  VARCHAR(100),
  specialty         TEXT,
  last_enriched_at  TIMESTAMP,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_references_team_idx ON sales_references(team_id);

CREATE TABLE IF NOT EXISTS sales_insights (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  reference_id  UUID REFERENCES sales_references(id) ON DELETE SET NULL,
  category      VARCHAR(100),
  title         VARCHAR(300),
  insight       TEXT NOT NULL,
  source_url    TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sales_insights_team_idx    ON sales_insights(team_id);
CREATE INDEX IF NOT EXISTS sales_insights_category_idx ON sales_insights(category);

-- ─── Coaching Sessions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS coaching_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'active',
  full_transcript  TEXT NOT NULL DEFAULT '',
  tips             JSONB NOT NULL DEFAULT '[]',
  started_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMP
);

CREATE INDEX IF NOT EXISTS coaching_sessions_user_idx ON coaching_sessions(user_id);
CREATE INDEX IF NOT EXISTS coaching_sessions_team_idx ON coaching_sessions(team_id);

-- ─── Default Sales References (seed) ─────────────────────────────────────────
-- Seeded per team via application code, not here (team_id unknown at migration time)
