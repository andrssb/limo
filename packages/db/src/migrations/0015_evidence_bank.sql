-- ─── Evidence bank ───────────────────────────────────────────────────────────
-- Evolve enr_sources into the evidence bank: each data point can now carry the
-- exact snippet where it was found and be linked to BOTH a person and a company
-- (not just a single generic entity), so the crawler can record auditable
-- evidence like "phone X found on snippet Y at company Z, tied to person W".

ALTER TABLE enr_sources ADD COLUMN IF NOT EXISTS snippet    TEXT;
ALTER TABLE enr_sources ADD COLUMN IF NOT EXISTS person_id  UUID;
ALTER TABLE enr_sources ADD COLUMN IF NOT EXISTS company_id UUID;

-- Phone ownership kind (distinct from source_type): tells whether a phone is the
-- person's direct line vs a company channel, so the UI never presents a company
-- phone as the decision-maker's direct number.
--   direto_pessoa | comercial_empresa | whatsapp_comercial | atendimento | unidade | generico | sem_evidencia
ALTER TABLE enr_sources ADD COLUMN IF NOT EXISTS phone_kind VARCHAR(40);

CREATE INDEX IF NOT EXISTS enr_sources_person_idx  ON enr_sources (person_id);
CREATE INDEX IF NOT EXISTS enr_sources_company_idx ON enr_sources (company_id);
