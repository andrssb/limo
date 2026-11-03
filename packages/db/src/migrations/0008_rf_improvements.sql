-- ─── Migration 0008: RF schema improvements + companies_search view ─────────

ALTER TABLE disc_companies
  ADD COLUMN IF NOT EXISTS opening_date     DATE,
  ADD COLUMN IF NOT EXISTS public_phone     VARCHAR(30),
  ADD COLUMN IF NOT EXISTS public_email     VARCHAR(320),
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS disc_companies_opening_date_idx ON disc_companies (opening_date);

-- Consolidated search view: disc_companies + sector (via CNAE map) + top domain
CREATE OR REPLACE VIEW companies_search AS
SELECT
  c.id,
  c.cnpj,
  c.legal_name,
  c.trade_name,
  c.state,
  c.city,
  c.main_cnae,
  c.secondary_cnaes,
  c.registration_status,
  c.company_size,
  c.capital_social,
  c.opening_date,
  c.public_phone,
  c.public_email,
  c.confidence_score,
  c.created_at,
  c.updated_at,
  sm.sector_name  AS sector,
  td.domain       AS top_domain,
  td.website_url  AS top_website_url
FROM disc_companies c
LEFT JOIN LATERAL (
  SELECT sector_name
  FROM   disc_sector_cnae_map
  WHERE  cnae_code = c.main_cnae AND active = TRUE
  ORDER  BY weight DESC
  LIMIT  1
) sm ON TRUE
LEFT JOIN LATERAL (
  SELECT domain, website_url
  FROM   disc_company_domains
  WHERE  company_id = c.id
  ORDER  BY confidence DESC
  LIMIT  1
) td ON TRUE;
