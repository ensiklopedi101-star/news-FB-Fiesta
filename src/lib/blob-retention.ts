import "server-only";
import { list, del } from "@vercel/blob";
import { DEFAULT_BLOB_RETENTION, pruneReason, type BlobPruneCandidate, type BlobRetentionPolicy } from "@/lib/blob-retention-policy";

/**
 * Vercel quotas are **account-wide**: three projects on the same team share one
 * Functions Storage pool and one Blob allowance. Inside this project the store grows
 * from article photos, quiz images, and — the biggest part — a full 1080×1920 PNG per
 * Reel scene plus the encoded MP4. This module keeps that footprint small.
 */
export { DEFAULT_BLOB_RETENTION, pruneReason };
export type { BlobPruneCandidate, BlobRetentionPolicy };

export type PruneResult = {
  scanned: number;
  matched: number;
  deleted: number;
  bytesFreed: number;
  dryRun: boolean;
  reasons: Record<string, number>;
  failures: number;
};

/**
 * Walks the Blob store (cursor-paged) and deletes generated media past its window.
 * Sequential deletes keep the number of Blob operations predictable on Hobby plans.
 */
export async function pruneBlobStorage(options: {
  dryRun?: boolean;
  policy?: BlobRetentionPolicy;
  now?: Date;
  token?: string;
  batchLimit?: number;
} = {}): Promise<PruneResult> {
  const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN belum diatur.");
  const policy = options.policy ?? {
    reelFrameDays: Number(process.env.BLOB_REEL_FRAME_DAYS ?? DEFAULT_BLOB_RETENTION.reelFrameDays),
    reelVideoDays: Number(process.env.BLOB_REEL_VIDEO_DAYS ?? DEFAULT_BLOB_RETENTION.reelVideoDays),
    quizDays: Number(process.env.BLOB_QUIZ_DAYS ?? DEFAULT_BLOB_RETENTION.quizDays),
    articleImageDays: Number(process.env.BLOB_ARTICLE_IMAGE_DAYS ?? DEFAULT_BLOB_RETENTION.articleImageDays),
  };
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? 1_000;

  const result: PruneResult = { scanned: 0, matched: 0, deleted: 0, bytesFreed: 0, dryRun: Boolean(options.dryRun), reasons: {}, failures: 0 };
  const candidates: BlobPruneCandidate[] = [];
  let cursor: string | undefined;

  do {
    const page = await list({ token, cursor, limit: 500 });
    for (const blob of page.blobs) {
      result.scanned += 1;
      const reason = pruneReason(blob.pathname, blob.uploadedAt, policy, now);
      if (!reason) continue;
      result.matched += 1;
      result.reasons[reason.split(" lebih")[0]!] = (result.reasons[reason.split(" lebih")[0]!] ?? 0) + 1;
      candidates.push({ url: blob.url, pathname: blob.pathname, reason, size: blob.size ?? 0 });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && result.scanned < 20_000);

  const selected = candidates.slice(0, batchLimit);
  if (!options.dryRun && selected.length) {
    // `del` accepts an array; chunk it so a huge backlog never sends one giant request.
    for (let index = 0; index < selected.length; index += 100) {
      const chunk = selected.slice(index, index + 100);
      try {
        await del(chunk.map((item) => item.url), { token });
        result.deleted += chunk.length;
        result.bytesFreed += chunk.reduce((total, item) => total + item.size, 0);
      } catch (error) {
        result.failures += chunk.length;
        console.error("[blob-prune] gagal menghapus sebagian berkas:", error instanceof Error ? error.message : error);
      }
    }
  }

  return result;
}
