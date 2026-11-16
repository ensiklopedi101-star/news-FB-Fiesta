import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchRecentStories } from "@/lib/feeds";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { storeArticleImageInBlob } from "@/lib/blob-image";

const MAX_ARTICLES_PER_HARVEST = PUBLISH_POLICY.maxArticlesPerHarvest;

export async function harvestLatestStories() {
  const stories = await fetchRecentStories();
  const candidates = stories.slice(0, MAX_ARTICLES_PER_HARVEST);
  if (candidates.length === 0) return { scanned: stories.length, added: 0, enriched: 0, limited: false };

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
      updatedAt: new Date(),
    })
    .where(and(eq(articles.urlHash, story.urlHash), eq(articles.status, "queued")))
    .returning({ id: articles.id, urlHash: articles.urlHash })));

  const storiesByHash = new Map(candidates.map((story) => [story.urlHash, story]));
  const imageTargets = new Map<string, { id: string; story: (typeof candidates)[number] }>();
  for (const row of inserted) {
    const story = storiesByHash.get(row.urlHash);
    if (story?.imageUrl) imageTargets.set(row.id, { id: row.id, story });
  }
  for (const rows of enriched) {
    for (const row of rows) {
      const story = storiesByHash.get(row.urlHash);
      if (story?.imageUrl) imageTargets.set(row.id, { id: row.id, story });
    }
  }

  if (imageTargets.size && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.warn("[harvest] BLOB_READ_WRITE_TOKEN is missing; source image URLs will remain unchanged.");
  } else {
    const targets = [...imageTargets.values()];
    for (let offset = 0; offset < targets.length; offset += 10) {
      await Promise.all(targets.slice(offset, offset + 10).map(async ({ id, story }) => {
        const blobUrl = await storeArticleImageInBlob(id, story.imageUrl, story.sourceUrl);
        if (!blobUrl || !story.imageUrl) return;
        try {
          await db.update(articles)
            .set({ imageUrl: blobUrl, updatedAt: new Date() })
            .where(and(eq(articles.id, id), eq(articles.imageUrl, story.imageUrl), eq(articles.status, "queued")));
        } catch {
          console.error(`[harvest] Blob image uploaded but Neon URL update failed for article ${id}.`);
        }
      }));
    }
  }

  return {
    scanned: stories.length,
    added: inserted.length,
    enriched: enriched.reduce((count, rows) => count + rows.length, 0),
    limited: stories.length > MAX_ARTICLES_PER_HARVEST,
  };
}
