-- Fase 4 do Coaching IA: Qualificador de Garantia do Lead.
-- Disponível só para Heads/gestores/admin. Avalia a qualidade real do lead com
-- base na Educação de Produto (ICP/personas/playbook) + interações registradas.
--
-- origin         = origem COMERCIAL detectada (inbound/outbound/referral/partner/other)
-- classification = qualified | partial | disqualified
-- score          = { overall, icpFit, pains, buyingMoment, financialPotential, decisionMaker, interest, rationale }
-- reasons        = motivos da classificação
-- marketing_note = sinal estratégico pro Marketing (segmentação/ICP/cargo/ticket/dor)

CREATE TABLE IF NOT EXISTS lead_qualifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id        uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  origin         text NOT NULL DEFAULT 'other',
  classification text NOT NULL,
  score          jsonb NOT NULL,
  reasons        jsonb NOT NULL DEFAULT '[]',
  summary        text NOT NULL,
  marketing_note text,
  status         processing_status NOT NULL DEFAULT 'done',
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_qual_contact_idx ON lead_qualifications (contact_id);
CREATE INDEX IF NOT EXISTS lead_qual_team_idx    ON lead_qualifications (team_id, created_at);
