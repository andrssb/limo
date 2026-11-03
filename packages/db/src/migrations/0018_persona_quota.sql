-- 0018_persona_quota.sql
-- Garimpo IA persona quota tracking on teams.
-- Unit counted: 1 contact returned by Garimpo IA. Creating personas is free.
-- The monthly allowance per plan lives in application code, not here.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS personas_used_current_period integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personas_extra_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS personas_period_started_at timestamp;
