-- 0017_trial_and_job.sql
-- Adds trial expiry tracking to teams and job title to users.
-- Existing teams keep trial_ends_at = NULL (no expiry — grandfathered).
-- New teams will have trial_ends_at set by the application at creation time.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS job_title varchar(200);

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamp;
