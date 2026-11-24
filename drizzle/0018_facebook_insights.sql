CREATE TABLE IF NOT EXISTS "facebook_post_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "page_id" text NOT NULL,
  "facebook_post_id" text NOT NULL,
  "media_views" integer DEFAULT 0 NOT NULL,
  "unique_viewers" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "reactions" integer DEFAULT 0 NOT NULL,
  "comments" integer DEFAULT 0 NOT NULL,
  "shares" integer DEFAULT 0 NOT NULL,
  "video_views" integer DEFAULT 0 NOT NULL,
  "interactions_available" boolean DEFAULT false NOT NULL,
  "synced_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "facebook_post_insights_page_post_unique"
  ON "facebook_post_insights" ("page_id", "facebook_post_id");
CREATE INDEX IF NOT EXISTS "facebook_post_insights_synced_idx"
  ON "facebook_post_insights" ("synced_at");

CREATE TABLE IF NOT EXISTS "facebook_insights_sync_state" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "locked_until" timestamp with time zone DEFAULT 'epoch' NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "last_success_at" timestamp with time zone,
  "last_error" text,
  "posts_synced" integer DEFAULT 0 NOT NULL,
  "posts_failed" integer DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
