-- Strong join key: tie people in enr_people to Receita Federal companies by CNPJ.
-- Stored digits-only so it matches regardless of formatting differences.

ALTER TABLE enr_people ADD COLUMN IF NOT EXISTS cnpj VARCHAR(14);

CREATE INDEX IF NOT EXISTS enr_people_cnpj_idx ON enr_people (cnpj);

-- Enables efficient domain -> CNPJ resolution (disc_company_domains had no
-- index on the domain column, only on company_id/confidence).
CREATE INDEX IF NOT EXISTS disc_domains_domain_idx ON disc_company_domains (lower(domain));
