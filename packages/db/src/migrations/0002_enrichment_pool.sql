CREATE TABLE IF NOT EXISTS enrichment_pool (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linkedin_url    text UNIQUE,
  full_name       varchar(300),
  company_domain  varchar(300),
  email           varchar(320),
  email_confidence varchar(20) DEFAULT 'guessed',
  emails_found    text[]       NOT NULL DEFAULT '{}',
  phones_found    text[]       NOT NULL DEFAULT '{}',
  processes_found integer      NOT NULL DEFAULT 0,
  sources         text[]       NOT NULL DEFAULT '{}',
  raw_data        jsonb        NOT NULL DEFAULT '{}',
  last_enriched_at timestamp   NOT NULL DEFAULT now(),
  created_at      timestamp    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enrichment_pool_name_idx    ON enrichment_pool (full_name);
CREATE INDEX IF NOT EXISTS enrichment_pool_domain_idx  ON enrichment_pool (company_domain);
CREATE INDEX IF NOT EXISTS enrichment_pool_email_idx   ON enrichment_pool (email);
