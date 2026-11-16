import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { fetchArticlePage, MAX_ARTICLE_SNIPPET_CHARS } from "@/lib/article-page";
import { isSafePublicImageUrl } from "@/lib/safe-url";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { rssSources, type RssSource } from "@/lib/schema";

export type FeedStory = {
  sourceName: string;
  category: string;
  pageKey: "news" | "entertainment";
  sourceUrl: string;
  urlHash: string;
  title: string;
  rawText: string;
  imageUrl: string | null;
  feedPublishedAt: Date | null;
  enriched: boolean;
};

const parser = new Parser({
  timeout: 12_000,
  headers: { "user-agent": "NewsFiestaBot/1.0 (+RSS news summarizer)" },
  customFields: {
    item: [["content:encoded", "contentEncoded"], ["media:content", "mediaContent"], ["media:thumbnail", "mediaThumbnail"]],
  },
});

function cleanText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function usableUrl(candidate: unknown, baseUrl: string): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  try {
    const url = new URL(candidate, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function usableImageUrl(candidate: unknown, baseUrl: string): string | null {
  const url = typeof candidate === "string" ? usableUrl(candidate, baseUrl) : null;
  return url && isSafePublicImageUrl(url) ? url : null;
}

function getImage(item: Record<string, unknown>, sourceUrl: string): string | null {
  const enclosure = item.enclosure as { url?: unknown } | undefined;
  const media = item.mediaContent as { $?: { url?: unknown } } | undefined;
  const thumbnail = item.mediaThumbnail as { $?: { url?: unknown } } | undefined;
  const encoded = String(item.contentEncoded ?? item.content ?? "");
  const fromHtml = encoded.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  return usableImageUrl(enclosure?.url, sourceUrl)
    ?? usableImageUrl(media?.$?.url, sourceUrl)
    ?? usableImageUrl(thumbnail?.$?.url, sourceUrl)
    ?? usableImageUrl(fromHtml, sourceUrl);
}

function canonicalize(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function matchesKeywords(source: RssSource, title: string, content: string): boolean {
  if (source.keywords.length === 0) return true;
  const haystack = `${title} ${content}`.toLocaleLowerCase();
  return source.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase()));
}

async function fetchOneSource(source: RssSource, perFeed: number, cutoff: number): Promise<FeedStory[]> {
  const db = getDb();
  try {
    const response = await fetch(source.feedUrl, {
      headers: { "user-agent": "NewsFiestaBot/1.0 (+RSS news summarizer)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Feed membalas HTTP ${response.status}.`);
    const parsed = await parser.parseString(await response.text());
    await db.update(rssSources)
      .set({ lastFetchedAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(rssSources.id, source.id));

    const stories: FeedStory[] = [];
    for (const entry of (parsed.items ?? []).slice(0, perFeed)) {
      const item = entry as unknown as Record<string, unknown>;
      const title = cleanText(String(item.title ?? ""));
      const rawLink = usableUrl(item.link, source.feedUrl);
      if (!title || !rawLink) continue;
      const published = Date.parse(String(item.isoDate ?? item.pubDate ?? ""));
      if (Number.isFinite(published) && published < cutoff) continue;
      const content = cleanText(String(item.contentEncoded ?? item.contentSnippet ?? item.content ?? item.summary ?? ""));
      if (!matchesKeywords(source, title, content)) continue;
      const sourceUrl = canonicalize(rawLink);
      const rawText = [title, content].filter(Boolean).join("\n\n").slice(0, MAX_ARTICLE_SNIPPET_CHARS);
      stories.push({
        sourceName: source.name,
        category: source.category,
        pageKey: source.pageKey,
        sourceUrl,
        urlHash: createHash("sha256").update(sourceUrl).digest("hex"),
        title,
        rawText,
        imageUrl: getImage(item, sourceUrl),
        feedPublishedAt: Number.isFinite(published) ? new Date(published) : null,
        enriched: false,
      });
    }
    return stories;
  } catch (error) {
    const message = error instanceof Error ? error.message : "RSS fetch gagal.";
    console.error(`[rss] ${source.name}:`, message);
    await db.update(rssSources)
      .set({ lastFetchedAt: new Date(), lastError: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(rssSources.id, source.id));
    return [];
  }
}

async function enrichStory(story: FeedStory): Promise<FeedStory> {
  const page = await fetchArticlePage(story.sourceUrl);
  if (!page) return story;

  const rssContent = story.rawText.startsWith(story.title)
    ? story.rawText.slice(story.title.length).trim()
    : story.rawText;
  const content = page.text || rssContent;
  const rawText = [story.title, content].filter(Boolean).join("\n\n").slice(0, MAX_ARTICLE_SNIPPET_CHARS);
  return {
    ...story,
    rawText,
    imageUrl: story.imageUrl || page.imageUrl,
    enriched: Boolean(page.text || page.imageUrl),
  };
}

async function mapWithConcurrency<T, U>(items: T[], concurrency: number, worker: (item: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function fetchRecentStories(): Promise<FeedStory[]> {
  const feeds = await getDb().select().from(rssSources).where(eq(rssSources.active, true));
  const perFeed = 8;
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  const results = await Promise.all(feeds.map((feed) => fetchOneSource(feed, perFeed, cutoff)));
  const stories = results.flat().sort((a, b) => (b.feedPublishedAt?.getTime() ?? 0) - (a.feedPublishedAt?.getTime() ?? 0));
  const harvestCandidates = stories.slice(0, PUBLISH_POLICY.maxArticlesPerHarvest);
  const enriched = await mapWithConcurrency(harvestCandidates, 8, enrichStory);
  return [...enriched, ...stories.slice(harvestCandidates.length)];
}
