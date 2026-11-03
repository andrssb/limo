-- Apollo people cache: stores every person returned by Apollo API
-- to avoid re-paying credits for the same lookup

CREATE TABLE IF NOT EXISTS enr_people (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       VARCHAR(300) NOT NULL,
  first_name      VARCHAR(150),
  last_name       VARCHAR(150),
  job_title       TEXT,
  seniority       VARCHAR(50),
  company_name    VARCHAR(300),
  company_domain  VARCHAR(300),
  linkedin_url    TEXT,
  email           VARCHAR(320),
  email_status    VARCHAR(30),   -- 'verified', 'guessed', 'unverifiable'
  phone           VARCHAR(50),
  city            VARCHAR(150),
  state           VARCHAR(100),
  country         VARCHAR(100)   DEFAULT 'Brazil',
  source          VARCHAR(30)    NOT NULL DEFAULT 'apollo',
  raw_data        JSONB          NOT NULL DEFAULT '{}',
  cached_at       TIMESTAMP      NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMP      NOT NULL DEFAULT NOW() + INTERVAL '60 days'
);

CREATE UNIQUE INDEX IF NOT EXISTS enr_people_linkedin_idx
  ON enr_people (linkedin_url)
  WHERE linkedin_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS enr_people_domain_title_idx
  ON enr_people (company_domain, job_title);

CREATE INDEX IF NOT EXISTS enr_people_name_domain_idx
  ON enr_people (full_name, company_domain);

CREATE INDEX IF NOT EXISTS enr_people_expires_idx
  ON enr_people (expires_at);
