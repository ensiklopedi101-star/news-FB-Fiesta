import { load } from "cheerio";
import { isSafePublicImageUrl } from "@/lib/safe-url";

function usableImageUrl(candidate: unknown, baseUrl: string): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  try {
    const url = new URL(candidate, baseUrl);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    const absolute = url.toString();
    return isSafePublicImageUrl(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

function valuesFromMediaField(value: unknown): Array<{ url: unknown; type?: unknown }> {
  if (Array.isArray(value)) return value.flatMap(valuesFromMediaField);
  if (typeof value === "string") return [{ url: value }];
  if (!value || typeof value !== "object") return [];

  const entry = value as Record<string, unknown>;
  const attributes = entry.$ && typeof entry.$ === "object" ? entry.$ as Record<string, unknown> : {};
  const url = attributes.url ?? attributes.href ?? entry.url ?? entry.href;
  const type = attributes.type ?? entry.type;
  const result: Array<{ url: unknown; type?: unknown }> = url !== undefined && url !== null ? [{ url, type }] : [];
  // RSS extensions can wrap image fields in media:group or similar nested objects.
  for (const [key, child] of Object.entries(entry)) {
    if (key !== "$" && child && typeof child === "object") result.push(...valuesFromMediaField(child));
  }
  return result;
}

function urlsFromHtml(value: unknown): string[] {
  if (typeof value !== "string" || !value.includes("<")) return [];
  const $ = load(value);
  const urls: string[] = [];
  $("img").each((_, element) => {
    const image = $(element);
    for (const attribute of ["data-src", "data-original", "data-lazy-src"]) {
      const url = image.attr(attribute);
      if (url) urls.push(url);
    }
    const srcset = image.attr("srcset");
    if (srcset) {
      const candidates = srcset.split(",").map((candidate) => {
        const [url, descriptor = ""] = candidate.trim().split(/\s+/);
        const amount = Number.parseFloat(descriptor);
        const weight = descriptor.endsWith("w") ? amount : descriptor.endsWith("x") ? amount * 1_000 : 0;
        return { url, weight };
      }).filter((candidate) => candidate.url).sort((a, b) => b.weight - a.weight);
      urls.push(...candidates.map((candidate) => candidate.url));
    }
    const src = image.attr("src");
    if (src) urls.push(src);
  });
  return urls;
}

const MAX_ARTICLE_IMAGES = 3;
const DECORATIVE_IMAGE_WORDS = /(?:logo|avatar|author|profile|icon|sprite|advert|ads?|banner|tracking|pixel|button|social|share)/i;

function looksDecorative(url: string): boolean {
  try {
    const parsed = new URL(url);
    return DECORATIVE_IMAGE_WORDS.test(`${parsed.pathname} ${parsed.search}`);
  } catch {
    return true;
  }
}

/** Find up to three distinct safe, public HTTPS editorial images advertised by common RSS/Atom fields. */
export function extractFeedImageUrls(item: Record<string, unknown>, sourceUrl: string): string[] {
  const mediaFields = [
    ...valuesFromMediaField(item.enclosure),
    ...valuesFromMediaField(item.mediaContent),
    ...valuesFromMediaField(item.mediaThumbnail),
    ...valuesFromMediaField(item.image),
  ];
  const urls: string[] = [];
  const add = (candidate: unknown, type?: unknown) => {
    if (typeof type === "string" && !type.toLowerCase().startsWith("image/")) return;
    const url = usableImageUrl(candidate, sourceUrl);
    if (url && !looksDecorative(url) && !urls.includes(url)) urls.push(url);
  };
  for (const candidate of mediaFields) {
    add(candidate.url, candidate.type);
    if (urls.length === MAX_ARTICLE_IMAGES) return urls;
  }

  const htmlFields = [item.contentEncoded, item["content:encoded"], item.content, item.description, item.summary, item.contentSnippet];
  for (const field of htmlFields) {
    for (const candidate of urlsFromHtml(field)) {
      add(candidate);
      if (urls.length === MAX_ARTICLE_IMAGES) return urls;
    }
  }
  return urls;
}

/** Backward-compatible primary-image selector. */
export function extractFeedImageUrl(item: Record<string, unknown>, sourceUrl: string): string | null {
  return extractFeedImageUrls(item, sourceUrl)[0] ?? null;
}
