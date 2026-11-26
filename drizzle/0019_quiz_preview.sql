-- Legacy unposted silhouettes must never become publishable drafts.
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'legacy';
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS poster_sources jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE quiz_editions SET status = 'published' WHERE posted_at IS NOT NULL AND status = 'legacy';
ALTER TABLE quiz_editions ALTER COLUMN status SET DEFAULT 'draft';
