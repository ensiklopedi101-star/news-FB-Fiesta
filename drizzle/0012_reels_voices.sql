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
