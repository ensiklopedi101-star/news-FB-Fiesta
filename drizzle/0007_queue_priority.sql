ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS priority_at timestamptz;

CREATE INDEX IF NOT EXISTS articles_queued_priority_idx
  ON public.articles (priority_at, source_published_at, created_at)
  WHERE status = 'queued';
