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
