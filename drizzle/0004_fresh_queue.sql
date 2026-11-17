ALTER TYPE public.article_status ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE public.article_status ADD VALUE IF NOT EXISTS 'removed';

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS source_published_at timestamptz;

-- Existing RSS imports used the source publication time for created_at when available.
UPDATE public.articles
SET source_published_at = created_at
WHERE source_published_at IS NULL;

CREATE INDEX IF NOT EXISTS articles_status_source_published_idx
  ON public.articles (status, source_published_at);
