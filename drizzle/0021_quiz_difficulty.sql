ALTER TABLE quiz_editions ADD COLUMN IF NOT EXISTS difficulties jsonb NOT NULL DEFAULT '[]'::jsonb;
