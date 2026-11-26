-- Apply once during deployment, never from a request handler.
-- Leading equalities + reverse scan serve each brand's newest three posts.
CREATE INDEX IF NOT EXISTS articles_page_status_published_idx
  ON public.articles (page_key, status, published_at, id);
