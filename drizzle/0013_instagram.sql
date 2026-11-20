-- Mirror every published post to Instagram (@popbeez.hive).
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "instagram_media_id" text;
