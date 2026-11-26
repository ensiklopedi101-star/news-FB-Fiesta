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
