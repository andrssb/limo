-- ─── Fuzzy name matching (pg_trgm) ───────────────────────────────────────────
-- The Garimpo matches extension-fed people (enr_people) to RF companies. With no
-- CNPJ/domain link available in prod, the match relies on the company name, and
-- exact-after-normalization is too strict (LinkedIn brand vs RF legal name).
-- pg_trgm enables similarity() so findInBase can fuzzy-match company names.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS enr_people_name_trgm_idx
  ON enr_people USING gin (company_name_norm gin_trgm_ops);
