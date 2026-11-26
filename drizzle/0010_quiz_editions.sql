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
