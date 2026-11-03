-- Enrichment engine — normalized companies, domains, email patterns, source audit

-- ─── Normalized companies (global, not team-scoped) ──────────────────────────
CREATE TABLE enr_companies (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(300) NOT NULL,
  trade_name        VARCHAR(300),
  legal_name        VARCHAR(300),
  cnpj              VARCHAR(18)  UNIQUE,
  sector            VARCHAR(200),
  state             VARCHAR(2),
  city              VARCHAR(200),
  employee_range    VARCHAR(20),              -- "1-10" | "11-50" | "51-200" | "201-500" | "501+"
  confidence_score  INTEGER      NOT NULL DEFAULT 0,
  last_enriched_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX enr_companies_name_idx    ON enr_companies (lower(name));
CREATE INDEX enr_companies_cnpj_idx    ON enr_companies (cnpj);
CREATE INDEX enr_companies_sector_idx  ON enr_companies (sector);
CREATE INDEX enr_companies_state_idx   ON enr_companies (state);

-- ─── Official domains per company ────────────────────────────────────────────
CREATE TABLE enr_domains (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID         NOT NULL REFERENCES enr_companies(id) ON DELETE CASCADE,
  domain           VARCHAR(300) NOT NULL,
  is_official      BOOLEAN      NOT NULL DEFAULT FALSE,
  confidence_score INTEGER      NOT NULL DEFAULT 0,
  source           VARCHAR(100),   -- 'cnpj_email' | 'mx_lookup' | 'playwright' | 'ai_inferred'
  verified_at      TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT enr_domains_uniq UNIQUE (company_id, domain)
);

CREATE INDEX enr_domains_company_idx ON enr_domains (company_id);
CREATE INDEX enr_domains_domain_idx  ON enr_domains (domain);

-- ─── Learned email patterns per domain ───────────────────────────────────────
CREATE TABLE enr_email_patterns (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  domain           VARCHAR(300) NOT NULL UNIQUE,
  pattern          VARCHAR(100) NOT NULL,  -- 'first.last' | 'flast' | 'first' | 'lastfirst' ...
  mx_provider      VARCHAR(100),
  examples         TEXT[]       NOT NULL DEFAULT '{}',
  confidence_score INTEGER      NOT NULL DEFAULT 0,
  sample_count     INTEGER      NOT NULL DEFAULT 1,
  last_validated_at TIMESTAMP,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX enr_email_patterns_domain_idx ON enr_email_patterns (domain);

-- ─── Source audit trail ───────────────────────────────────────────────────────
-- Every enriched data point records where it came from, when, and how confident.
CREATE TABLE enr_sources (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      VARCHAR(50) NOT NULL,    -- 'company' | 'contact' | 'domain' | 'phone' | 'email'
  entity_id        UUID        NOT NULL,
  field_name       VARCHAR(100) NOT NULL,   -- 'phone' | 'email' | 'domain' | 'whatsapp' ...
  field_value      TEXT        NOT NULL,
  source_type      VARCHAR(100) NOT NULL,   -- see PhoneSourceType / EmailSourceType
  source_priority  INTEGER,                 -- 1-8 (lower = more authoritative)
  source_url       TEXT,
  confidence_score INTEGER      NOT NULL DEFAULT 0,
  collected_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  validated_at     TIMESTAMP,
  is_valid         BOOLEAN
);

CREATE INDEX enr_sources_entity_idx    ON enr_sources (entity_type, entity_id);
CREATE INDEX enr_sources_field_idx     ON enr_sources (field_name);
CREATE INDEX enr_sources_type_idx      ON enr_sources (source_type);
CREATE INDEX enr_sources_collected_idx ON enr_sources (collected_at DESC);
