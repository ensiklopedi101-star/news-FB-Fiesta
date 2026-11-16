import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchRecentStories } from "@/lib/feeds";
import { PUBLISH_POLICY } from "@/lib/schedule";

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
    .returning({ id: articles.id });

  const enrichedStories = candidates.filter((story) => story.enriched);
  const enriched = await Promise.all(enrichedStories.map((story) => db.update(articles)
    .set({
      rawText: story.rawText,
      ...(story.imageUrl ? { imageUrl: story.imageUrl } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(articles.urlHash, story.urlHash), eq(articles.status, "queued")))
    .returning({ id: articles.id })));

  return {
    scanned: stories.length,
    added: inserted.length,
    enriched: enriched.reduce((count, rows) => count + rows.length, 0),
    limited: stories.length > MAX_ARTICLES_PER_HARVEST,
  };
}
