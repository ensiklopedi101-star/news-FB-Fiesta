CREATE TABLE IF NOT EXISTS "automation_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source" text NOT NULL,
  "trigger" text NOT NULL DEFAULT 'scheduled',
  "outcome" text NOT NULL,
  "summary" text NOT NULL,
  "detail" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "automation_logs_created_idx" ON "automation_logs" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "automation_logs_source_created_idx" ON "automation_logs" ("source", "created_at" DESC);
