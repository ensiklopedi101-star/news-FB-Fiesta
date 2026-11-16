CREATE TABLE IF NOT EXISTS public.rss_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  page_key public.article_page_key NOT NULL DEFAULT 'news',
  feed_url text NOT NULL,
  language text NOT NULL DEFAULT 'id',
  active boolean NOT NULL DEFAULT true,
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rss_sources_feed_url_unique
  ON public.rss_sources (feed_url);

CREATE INDEX IF NOT EXISTS rss_sources_active_page_idx
  ON public.rss_sources (active, page_key);
