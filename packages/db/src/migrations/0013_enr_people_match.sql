-- Add a normalized company name to enr_people so the Garimpo can reliably join
-- people to companies (LinkedIn brand name vs Receita Federal legal name).

ALTER TABLE enr_people ADD COLUMN IF NOT EXISTS company_name_norm VARCHAR(300);

CREATE INDEX IF NOT EXISTS enr_people_name_norm_idx
  ON enr_people (company_name_norm);

-- Best-effort backfill for existing rows: lowercase + strip trailing legal
-- suffixes (accents are not removed here — the app normalizer handles those for
-- new rows; legacy rows still benefit from suffix/case normalization).
UPDATE enr_people
SET company_name_norm = lower(
  regexp_replace(
    company_name,
    '\s+(s\.?a\.?|ltda\.?|me\.?|epp\.?|eireli\.?|s/a|sa)\.?\s*$',
    '',
    'i'
  )
)
WHERE company_name IS NOT NULL AND company_name_norm IS NULL;

-- Canonicalize existing stored domains (drop protocol/www) so joins match.
UPDATE enr_people
SET company_domain = lower(
  regexp_replace(regexp_replace(company_domain, '^https?://', '', 'i'), '^www\.', '', 'i')
)
WHERE company_domain IS NOT NULL;
