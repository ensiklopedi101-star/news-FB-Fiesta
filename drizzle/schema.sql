CREATE TYPE "public"."article_status" AS ENUM ('queued', 'processing', 'ready', 'published', 'failed', 'expired', 'removed');
CREATE TYPE "public"."article_page_key" AS ENUM ('news', 'entertainment');
CREATE TYPE "public"."article_post_format" AS ENUM ('single', 'carousel');

CREATE TABLE "rss_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "page_key" "article_page_key" DEFAULT 'news' NOT NULL,
  "feed_url" text NOT NULL,
  "language" text DEFAULT 'id' NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "keywords" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "last_fetched_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "rss_sources_feed_url_unique" ON "rss_sources" USING btree ("feed_url");
CREATE INDEX "rss_sources_active_page_idx" ON "rss_sources" USING btree ("active", "page_key");

CREATE TABLE "articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_name" text NOT NULL,
  "category" text NOT NULL,
  "page_key" "article_page_key" DEFAULT 'news' NOT NULL,
  "source_url" text NOT NULL,
  "url_hash" text NOT NULL,
  "title" text NOT NULL,
  "original_title" text NOT NULL,
  "raw_text" text DEFAULT '' NOT NULL,
  "image_url" text,
  "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "manual_image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "caption" text,
  "status" "article_status" DEFAULT 'queued' NOT NULL,
  "facebook_post_id" text,
  "error_message" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "source_published_at" timestamp with time zone,
  "priority_at" timestamp with time zone,
  "post_format" "article_post_format" DEFAULT 'single' NOT NULL,
  "carousel_slides" jsonb,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "articles_url_hash_unique" ON "articles" USING btree ("url_hash");
CREATE INDEX "articles_status_created_idx" ON "articles" USING btree ("status", "created_at");
CREATE INDEX "articles_page_status_created_idx" ON "articles" USING btree ("page_key", "status", "created_at");
CREATE INDEX "articles_page_status_published_idx" ON "articles" USING btree ("page_key", "status", "published_at", "id");
CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at");
CREATE INDEX "articles_status_source_published_idx" ON "articles" USING btree ("status", "source_published_at");
CREATE INDEX "articles_queued_priority_idx" ON "articles" USING btree ("priority_at", "source_published_at", "created_at") WHERE "status" = 'queued';
CREATE INDEX "articles_post_format_created_idx" ON "articles" USING btree ("post_format", "created_at");

CREATE TABLE "publisher_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "locked_until" timestamp with time zone DEFAULT 'epoch' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "publisher_state_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "publisher_state" ("id") VALUES (1);

CREATE TABLE IF NOT EXISTS "short_links" (
  "slug" text PRIMARY KEY NOT NULL,
  "target_url" text NOT NULL,
  "article_id" uuid,
  "clicks" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_clicked_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "short_links_created_idx" ON "short_links" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "short_links_article_idx" ON "short_links" USING btree ("article_id");

CREATE TABLE IF NOT EXISTS "quiz_editions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "poster_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "review_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "image_url" text,
  "caption" text,
  "facebook_post_id" text,
  "error_message" text,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "quiz_editions_created_idx" ON "quiz_editions" USING btree ("created_at");

-- Keep every post above Facebook's "limited originality" line.
-- editorial_take: the analysis + opinion paragraph written for this post.
-- originality_score / originality_notes: deterministic check that blocks copy-paste captions.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "editorial_take" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "originality_score" integer DEFAULT 0 NOT NULL;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "originality_notes" jsonb;

-- Reels: spoken narration per article plus the standing editorial voices.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "editorial_voice" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "narration_script" text;

DO $$ BEGIN
  CREATE TYPE "reel_status" AS ENUM ('rendering', 'published', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "reels" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "article_id" uuid NOT NULL REFERENCES "articles"("id") ON DELETE CASCADE,
  "status" "reel_status" NOT NULL DEFAULT 'rendering',
  "narration" text,
  "voice_label" text,
  "duration_seconds" integer NOT NULL DEFAULT 0,
  "frame_count" integer NOT NULL DEFAULT 0,
  "video_url" text,
  "facebook_video_id" text,
  "error_message" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "reels_article_idx" ON "reels" ("article_id");
CREATE INDEX IF NOT EXISTS "reels_created_idx" ON "reels" ("created_at");

-- Mirror every published post to Instagram (@popbeez.hive).
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;

-- Re-mirror posts that are already live on Facebook to Instagram.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;
ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;

-- Content pillars so the publisher keeps the daily mix varied.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "pillar" text;

-- Shared Content Manager configuration and editorial memory.
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

CREATE INDEX IF NOT EXISTS "content_manager_decisions_created_idx"
  ON "content_manager_decisions" ("created_at" DESC);

-- Facebook post-level insights snapshots (Meta Graph API v25+ metric vocabulary).
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
-- Legacy unposted silhouettes must never become publishable drafts.
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'legacy';
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS poster_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE quiz_editions SET status = 'published' WHERE posted_at IS NOT NULL AND status = 'legacy';
ALTER TABLE quiz_editions ALTER COLUMN status SET DEFAULT 'draft';
CREATE TABLE IF NOT EXISTS artist_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment text NOT NULL,
  format text NOT NULL DEFAULT 'carousel_4',
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  preview_revision integer,
  preview_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_at timestamptz,
  published_at timestamptz,
  facebook_post_id text,
  instagram_media_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_contents_created_idx ON artist_contents (created_at);
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS difficulties jsonb NOT NULL DEFAULT '[]'::jsonb;
