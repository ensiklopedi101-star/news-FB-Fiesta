import Parser from "rss-parser";
import { createHash } from "node:crypto";
import { z } from "zod";

const feedSchema = z.object({
  name: z.string().min(1).max(80),
  category: z.string().min(1).max(24).transform((value) => value.toUpperCase()),
  url: z.string().url(),
  language: z.string().default("id"),
});

export type FeedConfig = z.infer<typeof feedSchema>;
export type FeedStory = {
  sourceName: string;
  category: string;
  sourceUrl: string;
  urlHash: string;
  title: string;
  rawText: string;
  imageUrl: string | null;
};

const parser = new Parser({
  timeout: 12_000,
  headers: { "user-agent": "NewsFiestaBot/1.0 (+RSS news summarizer)" },
  customFields: {
    item: [["content:encoded", "contentEncoded"], ["media:content", "mediaContent"], ["media:thumbnail", "mediaThumbnail"]],
  },
});

export function getFeeds(): FeedConfig[] {
  const raw = process.env.NEWS_FEEDS;
  if (!raw) throw new Error("NEWS_FEEDS belum diatur. Isi dengan JSON array feed RSS.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("NEWS_FEEDS bukan JSON yang valid.");
  }
  return z.array(feedSchema).min(1).parse(parsed);
}

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
    return url.toString();
  } catch {
    return null;
  }
}

function getImage(item: Record<string, unknown>, sourceUrl: string): string | null {
  const enclosure = item.enclosure as { url?: unknown } | undefined;
  const media = item.mediaContent as { $?: { url?: unknown } } | undefined;
  const thumbnail = item.mediaThumbnail as { $?: { url?: unknown } } | undefined;
  const encoded = String(item.contentEncoded ?? item.content ?? "");
  const fromHtml = encoded.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const fromMedia = media?.$?.url ?? thumbnail?.$?.url;
  return usableUrl(enclosure?.url, sourceUrl)
    ?? usableUrl(fromMedia, sourceUrl)
    ?? usableUrl(fromHtml, sourceUrl);
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

export async function fetchRecentStories(): Promise<FeedStory[]> {
  const feeds = getFeeds();
  const perFeed = Math.min(20, Math.max(1, Number(process.env.MAX_ITEMS_PER_FEED ?? 8) || 8));
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  const results = await Promise.all(feeds.map(async (feed): Promise<FeedStory[]> => {
    try {
      const response = await fetch(feed.url, {
        headers: { "user-agent": "NewsFiestaBot/1.0 (+RSS news summarizer)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = await parser.parseString(await response.text());
      const stories: FeedStory[] = [];
      for (const entry of (parsed.items ?? []).slice(0, perFeed)) {
        const item = entry as unknown as Record<string, unknown>;
        const title = cleanText(String(item.title ?? ""));
        const rawLink = usableUrl(item.link, feed.url);
        if (!title || !rawLink) continue;
        const published = Date.parse(String(item.isoDate ?? item.pubDate ?? ""));
        if (Number.isFinite(published) && published < cutoff) continue;
        const sourceUrl = canonicalize(rawLink);
        const content = cleanText(String(item.contentEncoded ?? item.contentSnippet ?? item.content ?? item.summary ?? ""));
        const rawText = [title, content].filter(Boolean).join("\n\n").slice(0, 14_000);
        stories.push({
          sourceName: feed.name,
          category: feed.category,
          sourceUrl,
          urlHash: createHash("sha256").update(sourceUrl).digest("hex"),
          title,
          rawText,
          imageUrl: getImage(item, sourceUrl),
        });
      }
      return stories;
    } catch (error) {
      console.error(`[rss] ${feed.name}:`, error instanceof Error ? error.message : error);
      return [];
    }
  }));
  return results.flat();
}
