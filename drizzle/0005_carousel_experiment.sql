DO $$ BEGIN
  CREATE TYPE public.article_post_format AS ENUM ('single', 'carousel');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS post_format public.article_post_format NOT NULL DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS carousel_slides jsonb;

CREATE INDEX IF NOT EXISTS articles_post_format_created_idx
  ON public.articles (post_format, created_at);
