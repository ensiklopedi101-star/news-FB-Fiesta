/**
 * Pure retention rules for the account-wide Vercel Blob quota. Kept free of
 * `server-only` so the policy can be unit-tested without the Blob SDK.
 */
export type BlobRetentionPolicy = {
  /** Frame PNGs are only used while rendering; one day is generous. */
  reelFrameDays: number;
  /** MP4s are re-used when the same Reel is re-posted; keep them a month. */
  reelVideoDays: number;
  quizDays: number;
  /** Article photos feed the OG cards of published posts. */
  articleImageDays: number;
};

export const DEFAULT_BLOB_RETENTION: BlobRetentionPolicy = {
  reelFrameDays: 1,
  reelVideoDays: 30,
  quizDays: 45,
  articleImageDays: 21,
};

export type BlobPruneCandidate = { url: string; pathname: string; reason: string; size: number };

/** Pure decision function so the policy is testable without touching the store. */
export function pruneReason(
  pathname: string,
  uploadedAt: Date | string | number,
  policy: BlobRetentionPolicy,
  now: Date = new Date(),
): string | null {
  const uploaded = uploadedAt instanceof Date ? uploadedAt : new Date(uploadedAt);
  const ageDays = (now.getTime() - uploaded.getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays)) return null;

  if (/^reels\/.+\/frame-\d+\.png$/i.test(pathname)) {
    return ageDays >= policy.reelFrameDays ? `frame Reel lebih dari ${policy.reelFrameDays} hari` : null;
  }
  if (/^reels\/.+\.(mp4|webm|mov)$/i.test(pathname)) {
    return ageDays >= policy.reelVideoDays ? `video Reel lebih dari ${policy.reelVideoDays} hari` : null;
  }
  if (/^quiz\/.+\.(jpg|jpeg|png)$/i.test(pathname)) {
    return ageDays >= policy.quizDays ? `gambar kuis lebih dari ${policy.quizDays} hari` : null;
  }
  if (/^article-images\//i.test(pathname) || /^articles\//i.test(pathname)) {
    return ageDays >= policy.articleImageDays ? `foto artikel lebih dari ${policy.articleImageDays} hari` : null;
  }
  // Unknown prefixes are left alone — never delete something the app did not create.
  return null;
}

