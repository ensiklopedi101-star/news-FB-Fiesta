import "server-only";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchRecentStories } from "@/lib/feeds";
import { PUBLISH_POLICY } from "@/lib/schedule";

const MAX_ARTICLES_PER_HARVEST = PUBLISH_POLICY.maxArticlesPerHarvest;

export async function harvestLatestStories() {
  const stories = await fetchRecentStories();
  const candidates = stories.slice(0, MAX_ARTICLES_PER_HARVEST);
  if (candidates.length === 0) return { scanned: stories.length, added: 0, limited: false };

  const inserted = await getDb().insert(articles).values(candidates.map((story) => ({
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

  return {
    scanned: stories.length,
    added: inserted.length,
    limited: stories.length > MAX_ARTICLES_PER_HARVEST,
  };
}
