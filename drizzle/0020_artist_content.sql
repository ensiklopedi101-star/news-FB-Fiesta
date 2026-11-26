CREATE TABLE IF NOT EXISTS artist_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment text NOT NULL,
  format text NOT NULL DEFAULT 'carousel_4',
  content jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 1,
  preview_revision integer,
  preview_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_at timestamptz,
  published_at timestamptz,
  facebook_post_id text,
  instagram_media_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artist_contents_created_idx ON artist_contents (created_at);
