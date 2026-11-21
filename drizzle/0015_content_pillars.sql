-- Content pillars so the publisher keeps the daily mix varied.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "pillar" text;
