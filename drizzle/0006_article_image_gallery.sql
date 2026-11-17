ALTER TABLE "articles"
  ADD COLUMN "image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;

UPDATE "articles"
SET "image_urls" = jsonb_build_array("image_url")
WHERE "image_url" IS NOT NULL;
