-- ─── Migration 0009: team plans ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'team_plan') THEN
    CREATE TYPE team_plan AS ENUM ('trial', 'start', 'metrics', 'business');
  END IF;
END$$;

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS plan team_plan NOT NULL DEFAULT 'trial';
