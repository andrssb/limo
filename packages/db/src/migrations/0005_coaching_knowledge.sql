CREATE TABLE IF NOT EXISTS "coaching_knowledge" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" varchar(20) NOT NULL DEFAULT 'url',
  "title" varchar(500),
  "source_url" text,
  "raw_content" text,
  "ai_summary" text,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "coaching_knowledge_team_idx" ON "coaching_knowledge" ("team_id");
