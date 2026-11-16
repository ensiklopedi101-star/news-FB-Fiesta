CREATE TYPE "public"."article_status" AS ENUM ('queued', 'processing', 'ready', 'published', 'failed');
CREATE TYPE "public"."article_page_key" AS ENUM ('news', 'entertainment');

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
  "caption" text,
  "status" "article_status" DEFAULT 'queued' NOT NULL,
  "facebook_post_id" text,
  "error_message" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "articles_url_hash_unique" ON "articles" USING btree ("url_hash");
CREATE INDEX "articles_status_created_idx" ON "articles" USING btree ("status", "created_at");
CREATE INDEX "articles_page_status_created_idx" ON "articles" USING btree ("page_key", "status", "created_at");
CREATE INDEX "articles_published_at_idx" ON "articles" USING btree ("published_at");

CREATE TABLE "publisher_state" (
  "id" integer PRIMARY KEY NOT NULL,
  "locked_until" timestamp with time zone DEFAULT 'epoch' NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "publisher_state_singleton_check" CHECK ("id" = 1)
);

INSERT INTO "publisher_state" ("id") VALUES (1);
