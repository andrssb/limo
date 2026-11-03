CREATE TABLE IF NOT EXISTS "team_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "code" varchar(12) NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "max_uses" integer,
  "uses" integer NOT NULL DEFAULT 0,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "team_invites_code_uniq" UNIQUE("code")
);

CREATE INDEX IF NOT EXISTS "invites_team_idx" ON "team_invites"("team_id");
