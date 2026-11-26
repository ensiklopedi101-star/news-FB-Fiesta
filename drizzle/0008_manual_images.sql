ALTER TABLE "articles"
  ADD COLUMN "manual_image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;
