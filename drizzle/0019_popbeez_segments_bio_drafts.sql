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
