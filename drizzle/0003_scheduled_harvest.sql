ALTER TABLE public.rss_sources
  ADD COLUMN IF NOT EXISTS keywords text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE TABLE IF NOT EXISTS public.publisher_state (
  id integer PRIMARY KEY CONSTRAINT publisher_state_singleton_check CHECK (id = 1),
  locked_until timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.publisher_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
