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
-- Keep editorial segment, pillar, and asset format as separate attribution dimensions.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "segment" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "content_format" text DEFAULT 'single_image' NOT NULL;

UPDATE "articles"
SET "content_format" = CASE WHEN "post_format" = 'carousel' THEN 'carousel' ELSE 'single_image' END
WHERE "content_format" IS NULL OR "content_format" = 'single_image' AND "post_format" = 'carousel';

UPDATE "articles"
SET "segment" = CASE
  WHEN upper("category") = 'FILM' THEN 'rating_film_top_5'
  WHEN upper("category") = 'MUSIK' THEN 'rating_music_top_5'
  ELSE 'rating_drama_top_5'
END,
"pillar" = COALESCE("pillar", 'list')
WHERE "source_name" IN ('Review manual PopBeez', 'Review manual Popbeez');

UPDATE "articles"
SET "segment" = 'artis_bio', "pillar" = COALESCE("pillar", 'analysis')
WHERE "source_name" = 'Artis Bio PopBeez';

UPDATE "articles"
SET "segment" = 'roundup'
WHERE "page_key" = 'entertainment'
  AND "facebook_post_id" IS NOT NULL
  AND "segment" IS NULL
  AND "source_name" NOT IN ('Review manual PopBeez', 'Review manual Popbeez', 'Artis Bio PopBeez');

CREATE INDEX IF NOT EXISTS "articles_segment_created_idx" ON "articles" ("segment", "created_at");
CREATE INDEX IF NOT EXISTS "articles_content_format_created_idx" ON "articles" ("content_format", "created_at");

-- Quiz answers are private redaction data, not part of the public caption or artwork.
ALTER TABLE "quiz_editions" ADD COLUMN IF NOT EXISTS "answer_key" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "quiz_editions" ADD COLUMN IF NOT EXISTS "segment" text DEFAULT 'tebak_drama' NOT NULL;
ALTER TABLE "quiz_editions" ADD COLUMN IF NOT EXISTS "content_format" text DEFAULT 'quiz_grid' NOT NULL;
ALTER TABLE "quiz_editions" ADD COLUMN IF NOT EXISTS "pillar" text DEFAULT 'community' NOT NULL;

-- Reels have their own segment and video format; their editorial pillar follows the source article.
ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "segment" text DEFAULT 'reel' NOT NULL;
ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "content_format" text DEFAULT 'video' NOT NULL;
ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "pillar" text;
UPDATE "reels" AS reel
SET "pillar" = article."pillar"
FROM "articles" AS article
WHERE reel."article_id" = article."id" AND reel."pillar" IS NULL;

-- Exact metric availability prevents an absent Graph field from being presented as a real zero.
ALTER TABLE "facebook_post_insights" ADD COLUMN IF NOT EXISTS "available_metrics" jsonb DEFAULT '[]'::jsonb NOT NULL;
UPDATE "facebook_post_insights" SET "synced_at" = 'epoch'::timestamptz WHERE "available_metrics" = '[]'::jsonb;

-- A preview is saved before an explicit publish action. Draft claims are one-use and expire.
CREATE TABLE IF NOT EXISTS "editorial_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "status" text DEFAULT 'previewed' NOT NULL,
  "payload" jsonb NOT NULL,
  "result_id" uuid,
  "error_message" text,
  "previewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "editorial_drafts_status_expiry_idx" ON "editorial_drafts" ("status", "expires_at");
CREATE INDEX IF NOT EXISTS "editorial_drafts_created_idx" ON "editorial_drafts" ("created_at");
