import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchRecentStories } from "@/lib/feeds";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { storeArticleImageInBlob } from "@/lib/blob-image";
import { isVercelBlobImageUrl } from "@/lib/og-image";
import { choosePostFormat } from "@/lib/queue-policy";

const MAX_ARTICLES_PER_HARVEST = PUBLISH_POLICY.maxArticlesPerHarvest;

export async function harvestLatestStories() {
  const stories = await fetchRecentStories();
  const candidates = stories.slice(0, MAX_ARTICLES_PER_HARVEST);
  if (candidates.length === 0) return { scanned: stories.length, added: 0, enriched: 0, imageCandidates: 0, imageBlobStored: 0, limited: false };

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
  const queuedCandidates = await db.select({ id: articles.id, urlHash: articles.urlHash, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls })
    .from(articles)
    .where(and(inArray(articles.urlHash, candidates.map((story) => story.urlHash)), eq(articles.status, "queued")));
  const imageTargets = new Map<string, { id: string; story: (typeof candidates)[number]; imageUrls: string[] }>();
  for (const row of queuedCandidates) {
    const story = storiesByHash.get(row.urlHash);
    const imageUrls = [...new Set([row.imageUrl, ...(row.imageUrls ?? []), ...(story?.imageUrls ?? [])].filter((url): url is string => Boolean(url)))].slice(0, 3);
    if (!story || imageUrls.length === 0) continue;
    try {
      await db.update(articles)
        .set({ imageUrl: row.imageUrl || imageUrls[0]!, imageUrls, updatedAt: new Date() })
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
      await Promise.all(targets.slice(offset, offset + 5).map(async ({ id, story, imageUrls }) => {
        const storedImages = await Promise.all(imageUrls.map(async (url, index) => {
          if (isVercelBlobImageUrl(url)) return { url, uploaded: false };
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
  };
}
