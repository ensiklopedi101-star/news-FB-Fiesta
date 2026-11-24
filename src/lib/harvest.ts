import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, rssSources } from "@/lib/schema";
import { fetchRecentStoriesWithMeta } from "@/lib/feeds";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { storeArticleImageInBlob } from "@/lib/blob-image";
import { isVercelBlobImageUrl } from "@/lib/og-image";
import { isKnownAggregatorBrandImage } from "@/lib/safe-url";
import { choosePostFormat } from "@/lib/queue-policy";
import { selectedRoundupImage } from "@/lib/roundup";
import { usesDirectFacebookPublishing } from "@/lib/publisher";
import { getBufferConfigurationGaps } from "@/lib/buffer";
import { shouldAutoHarvestBeforePublish } from "@/lib/automation-health";

const MAX_ARTICLES_PER_HARVEST = PUBLISH_POLICY.maxArticlesPerHarvest;

export type HarvestSummary = {
  scanned: number;
  added: number;
  enriched: number;
  imageCandidates: number;
  imageBlobStored: number;
  limited: boolean;
  feedsTotal: number;
  feedsFailed: number;
  feedErrors: Array<{ sourceName: string; message: string }>;
  elapsedMs: number;
};

export async function harvestLatestStories(options?: { budgetMs?: number }): Promise<HarvestSummary> {
  const startedAt = Date.now();
  const budgetMs = options?.budgetMs ?? 22_000;
  const blobDeadline = startedAt + Math.max(8_000, budgetMs - 2_000);
  const fetched = await fetchRecentStoriesWithMeta({ budgetMs: Math.max(6_000, budgetMs - 6_000) });
  const stories = fetched.stories;
  const candidates = stories.slice(0, MAX_ARTICLES_PER_HARVEST);
  if (candidates.length === 0) {
    return {
      scanned: stories.length,
      added: 0,
      enriched: 0,
      imageCandidates: 0,
      imageBlobStored: 0,
      limited: false,
      feedsTotal: fetched.feedsTotal,
      feedsFailed: fetched.feedsFailed,
      feedErrors: fetched.feedErrors,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const db = getDb();
  const inserted = await db.insert(articles).values(candidates.map((story) => ({
    sourceName: story.sourceName,
    category: story.category,
    pageKey: story.pageKey,
    sourceUrl: story.sourceUrl,
    urlHash: story.urlHash,
    title: story.title,
    originalTitle: story.title,
    rawText: story.rawText,
    imageUrl: story.imageUrl,
    imageUrls: story.imageUrls,
    sourcePublishedAt: story.feedPublishedAt,
    postFormat: choosePostFormat(story.urlHash),
    status: "queued" as const,
    createdAt: story.feedPublishedAt ?? new Date(),
  })))
    .onConflictDoNothing({ target: articles.urlHash })
    .returning({ id: articles.id, urlHash: articles.urlHash });

  const enrichedStories = candidates.filter((story) => story.enriched);
  const enriched = await Promise.all(enrichedStories.map((story) => db.update(articles)
    .set({
      rawText: story.rawText,
      ...(story.imageUrl ? { imageUrl: story.imageUrl } : {}),
      imageUrls: story.imageUrls,
      updatedAt: new Date(),
    })
    .where(and(eq(articles.urlHash, story.urlHash), eq(articles.status, "queued")))
    .returning({ id: articles.id, urlHash: articles.urlHash })));

  const storiesByHash = new Map(candidates.map((story) => [story.urlHash, story]));
  const queuedCandidates = await db.select({ id: articles.id, urlHash: articles.urlHash, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls, manualImageUrls: articles.manualImageUrls })
    .from(articles)
    .where(and(inArray(articles.urlHash, candidates.map((story) => story.urlHash)), eq(articles.status, "queued")));
  const imageTargets = new Map<string, { id: string; story: (typeof candidates)[number]; imageUrls: string[] }>();
  for (const row of queuedCandidates) {
    const story = storiesByHash.get(row.urlHash);
    const freshImages = [...new Set([story?.imageUrl, ...(story?.imageUrls ?? [])]
      .filter((url): url is string => Boolean(url) && !isKnownAggregatorBrandImage(url)))];
    const existingImages = [row.imageUrl, ...(row.imageUrls ?? [])]
      .filter((url): url is string => Boolean(url) && !isKnownAggregatorBrandImage(url));
    const manualImages = (row.manualImageUrls ?? []).filter((url): url is string => Boolean(url) && !isKnownAggregatorBrandImage(url));
    const imageUrls = [...new Set(manualImages.length ? manualImages : freshImages.length ? freshImages : existingImages)].slice(0, manualImages.length ? 2 : 3);
    if (!story || imageUrls.length === 0) continue;
    try {
      await db.update(articles)
        .set({ imageUrl: manualImages[0] ?? (story.imageUrl && !isKnownAggregatorBrandImage(story.imageUrl) ? story.imageUrl : imageUrls[0]!), imageUrls, ...(manualImages.length ? { manualImageUrls: imageUrls } : {}), updatedAt: new Date() })
        .where(and(eq(articles.id, row.id), eq(articles.status, "queued")));
    } catch {
      console.error(`[harvest] Article image gallery could not be saved to Neon for article ${row.id}.`);
      continue;
    }
    if (imageUrls.some((url) => !isVercelBlobImageUrl(url))) imageTargets.set(row.id, { id: row.id, story, imageUrls });
  }

  let imageBlobStored = 0;
  if (imageTargets.size && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("[harvest] BLOB_READ_WRITE_TOKEN is missing; source image URLs will remain unchanged.");
  } else {
    const targets = [...imageTargets.values()];
    for (let offset = 0; offset < targets.length; offset += 5) {
      if (Date.now() >= blobDeadline) break;
      await Promise.all(targets.slice(offset, offset + 5).map(async ({ id, story, imageUrls }) => {
        if (Date.now() >= blobDeadline) return;
        const storedImages = await Promise.all(imageUrls.map(async (url, index) => {
          if (isVercelBlobImageUrl(url) || Date.now() >= blobDeadline) return { url, uploaded: false };
          const blobUrl = await storeArticleImageInBlob(`${id}-${index + 1}`, url, story.sourceUrl);
          return { url: blobUrl ?? url, uploaded: Boolean(blobUrl) };
        }));
        const storedUrls = storedImages.map((image) => image.url);
        try {
          const linked = await db.update(articles)
            .set({ imageUrl: storedUrls[0] ?? null, imageUrls: storedUrls, updatedAt: new Date() })
            .where(and(eq(articles.id, id), eq(articles.status, "queued")))
            .returning({ id: articles.id });
          if (linked.length) imageBlobStored += storedImages.filter((image) => image.uploaded).length;
        } catch {
          console.error(`[harvest] Blob gallery uploaded but Neon URL update failed for article ${id}.`);
        }
      }));
    }
  }

  return {
    scanned: stories.length,
    added: inserted.length,
    enriched: enriched.reduce((count, rows) => count + rows.length, 0),
    imageCandidates: imageTargets.size,
    imageBlobStored,
    limited: stories.length > MAX_ARTICLES_PER_HARVEST,
    feedsTotal: fetched.feedsTotal,
    feedsFailed: fetched.feedsFailed,
    feedErrors: fetched.feedErrors,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function maybeAutoHarvestBeforePublish(): Promise<{
  triggered: boolean;
  reason: string | null;
  summary: HarvestSummary | null;
}> {
  const db = getDb();
  const [activeFeeds, queuedEntertainment] = await Promise.all([
    db.select({ lastFetchedAt: rssSources.lastFetchedAt }).from(rssSources).where(eq(rssSources.active, true)),
    db.select({
      imageUrl: articles.imageUrl,
      imageUrls: articles.imageUrls,
      manualImageUrls: articles.manualImageUrls,
    }).from(articles).where(and(eq(articles.status, "queued"), eq(articles.pageKey, "entertainment"))),
  ]);

  const lastFeedFetchedAt = activeFeeds.reduce<Date | null>((latest, feed) => {
    if (!feed.lastFetchedAt) return latest;
    return !latest || feed.lastFetchedAt > latest ? feed.lastFetchedAt : latest;
  }, null);
  const imageEligibleEntertainment = queuedEntertainment.filter((row) => Boolean(selectedRoundupImage(row))).length;
  const entertainmentConfigured = usesDirectFacebookPublishing("entertainment")
    || getBufferConfigurationGaps(["entertainment"]).length === 0;
  const decision = shouldAutoHarvestBeforePublish({
    activeFeedCount: activeFeeds.length,
    lastFeedFetchedAt,
    imageEligibleEntertainment,
    entertainmentConfigured,
  });

  if (!decision.shouldHarvest) {
    return { triggered: false, reason: null, summary: null };
  }

  const summary = await harvestLatestStories({ budgetMs: 14_000 });
  return { triggered: true, reason: decision.reason, summary };
}
