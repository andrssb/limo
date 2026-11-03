CREATE TABLE IF NOT EXISTS "list_companies" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "list_id"         uuid NOT NULL REFERENCES "lists"("id") ON DELETE CASCADE,
  "disc_company_id" uuid,
  "cnpj"            varchar(14),
  "legal_name"      varchar(300) NOT NULL,
  "trade_name"      varchar(300),
  "state"           varchar(2),
  "city"            varchar(150),
  "domain"          varchar(300),
  "sector"          varchar(150),
  "public_email"    varchar(320),
  "public_phone"    varchar(50),
  "added_at"        timestamp DEFAULT now() NOT NULL,
  "added_by"        uuid NOT NULL REFERENCES "users"("id")
);

CREATE INDEX IF NOT EXISTS "list_companies_list_idx" ON "list_companies" ("list_id");
CREATE UNIQUE INDEX IF NOT EXISTS "list_companies_list_cnpj_uniq" ON "list_companies" ("list_id", "cnpj");
