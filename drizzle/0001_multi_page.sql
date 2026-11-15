-- Route each RSS story to one of the two Facebook content channels.
DO $$ BEGIN
  CREATE TYPE "public"."article_page_key" AS ENUM ('news', 'entertainment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "articles"
  ADD COLUMN IF NOT EXISTS "page_key" "article_page_key" DEFAULT 'news' NOT NULL;

CREATE INDEX IF NOT EXISTS "articles_page_status_created_idx"
  ON "articles" USING btree ("page_key", "status", "created_at");
