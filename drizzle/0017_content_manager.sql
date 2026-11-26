CREATE TABLE IF NOT EXISTS "content_manager_config" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "auto_archive_duplicates" boolean DEFAULT true NOT NULL,
  "custom_directive" text DEFAULT '' NOT NULL,
  "focus_pillars" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "avoid_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "preferred_voice" text DEFAULT 'auto' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "content_manager_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "mode" text NOT NULL,
  "trigger" text DEFAULT 'publish' NOT NULL,
  "provider" text,
  "model" text,
  "slot_label" text,
  "selected_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "duplicate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recommended_voice" text,
  "seo_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "roundup_theme" text,
  "writer_brief" text,
  "editorial_reasoning" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "content_manager_decisions_created_idx" ON "content_manager_decisions" ("created_at" DESC);
