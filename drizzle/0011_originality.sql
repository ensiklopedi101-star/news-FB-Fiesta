-- Keep every post above Facebook's "limited originality" line.
-- editorial_take: the analysis + opinion paragraph written for this post.
-- originality_score / originality_notes: deterministic check that blocks copy-paste captions.
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "editorial_take" text;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "originality_score" integer DEFAULT 0 NOT NULL;
ALTER TABLE "articles" ADD COLUMN IF NOT EXISTS "originality_notes" jsonb;
