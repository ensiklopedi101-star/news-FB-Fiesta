-- Re-mirror posts that are already live on Facebook to Instagram.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;
ALTER TABLE "reels" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;
