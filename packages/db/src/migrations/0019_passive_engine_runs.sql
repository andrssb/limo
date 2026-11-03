-- 0019_passive_engine_runs.sql
-- Passive enrichment engine run tracking — one row per execution
-- (manual trigger by admin or daily cron). Powers the admin dashboard.

CREATE TABLE IF NOT EXISTS enr_runs (
  id                     uuid          primary key default gen_random_uuid(),
  triggered_by           varchar(20)   not null,             -- 'cron' | 'manual'
  triggered_by_user_id   uuid,                               -- nullable for cron
  status                 varchar(20)   not null default 'running', -- 'running' | 'done' | 'failed' | 'aborted'
  started_at             timestamp     not null default now(),
  completed_at           timestamp,
  duration_seconds       integer,
  companies_processed    integer       not null default 0,
  people_found           integer       not null default 0,
  job_titles_identified  integer       not null default 0,
  linkedin_urls_found    integer       not null default 0,
  emails_inferred        integer       not null default 0,
  phones_found           integer       not null default 0,
  records_saved          integer       not null default 0,
  errors_count           integer       not null default 0,
  log                    text[]        not null default '{}'
);

CREATE INDEX IF NOT EXISTS enr_runs_started_idx ON enr_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS enr_runs_status_idx  ON enr_runs (status);
