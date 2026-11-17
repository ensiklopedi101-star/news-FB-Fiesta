import { lookup } from "node:dns/promises";
import { load } from "cheerio";
import { isSafePublicImageUrl } from "@/lib/safe-url";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 2;
const ARTICLE_TIMEOUT_MS = 4_000;
const ARTICLE_PAGE_BUDGET_MS = 6_000;
const DNS_TIMEOUT_MS = 750;
export const MAX_ARTICLE_SNIPPET_CHARS = 1_500;

export type ArticlePageData = {
  text: string | null;
  imageUrl: string | null;
  imageUrls: string[];
};

function toSafeHttpsUrl(candidate: string, baseUrl?: string): string | null {
  try {
    const url = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
    return isSafePublicImageUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const groups = address.toLowerCase().split(":");
  const first = Number.parseInt(groups[0] || "0", 16);
  const second = Number.parseInt(groups[1] || "0", 16);
  // Only accept global-unicast space; reject mapped, local, multicast, transition and documentation ranges.
  if (!Number.isFinite(first) || first < 0x2000 || first >= 0x4000) return false;
  if (first === 0x2001 && [0x0000, 0x0002, 0x0010, 0x0db8].includes(second)) return false;
  if (first === 0x2002 || first === 0x3fff) return false;
  return true;
}

async function hasOnlyPublicAddresses(rawUrl: string, timeoutMs = DNS_TIMEOUT_MS): Promise<boolean> {
  const safeUrl = toSafeHttpsUrl(rawUrl);
  if (!safeUrl) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hostname = new URL(safeUrl).hostname;
    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timeout.")), Math.max(1, timeoutMs));
        timer.unref?.();
      }),
    ]);
    return addresses.length > 0 && addresses.every(({ address, family }) => family === 4
      ? isPublicIpv4(address)
      : family === 6 && isPublicIpv6(address));
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function extractSnippet($: ReturnType<typeof load>): string | null {
  $("script, style, noscript, nav, header, footer, aside, form, button, iframe, svg, figure, .advertisement, .ads, .related, .comments, .social-share, [aria-hidden='true']").remove();
  const selectors = [
    "article [itemprop='articleBody']",
    "[itemprop='articleBody']",
    "article",
    ".article-content",
    ".entry-content",
    ".post-content",
    "main",
    "body",
  ];
  let paragraphs: string[] = [];
  for (const selector of selectors) {
    const root = $(selector).first();
    if (!root.length) continue;
    paragraphs = root.find("p").toArray()
      .map((element) => $(element).text().replace(/\s+/g, " ").trim())
      .filter((text) => text.length >= 40)
      .slice(0, 2);
    if (paragraphs.length) break;
  }
  if (!paragraphs.length) return null;

  let result = "";
  for (const paragraph of paragraphs) {
    const remaining = MAX_ARTICLE_SNIPPET_CHARS - result.length;
    if (remaining <= 0) break;
    const clipped = paragraph.slice(0, remaining).trim();
    if (clipped) result = result ? `${result}\n\n${clipped}` : clipped;
  }
  return result || null;
}

const MAX_ARTICLE_IMAGES = 3;
const DECORATIVE_IMAGE_WORDS = /(?:logo|avatar|author|profile|icon|sprite|advert|ads?|banner|tracking|pixel|button|social|share|related)/i;

function extractPageData(html: string, pageUrl: string): ArticlePageData {
  const $ = load(html);
  const imageUrls: string[] = [];
  const addImage = (raw: string | undefined, label = "") => {
    if (!raw || DECORATIVE_IMAGE_WORDS.test(label)) return;
    const safe = toSafeHttpsUrl(raw, pageUrl);
    if (safe && !DECORATIVE_IMAGE_WORDS.test(new URL(safe).pathname) && !imageUrls.includes(safe) && imageUrls.length < MAX_ARTICLE_IMAGES) imageUrls.push(safe);
  };
  // Preserve publisher-declared hero image as the primary, then use only images inside article content.
  for (const selector of ["meta[property='og:image']", "meta[property='og:image:secure_url']", "meta[name='twitter:image']"]) {
    addImage($(selector).first().attr("content"));
  }
  const roots = $("article [itemprop='articleBody'], [itemprop='articleBody'], article, main, .article-content, .entry-content, .post-content");
  roots.each((_, root) => {
    if (imageUrls.length >= MAX_ARTICLE_IMAGES) return;
    $(root).find("img").each((__, element) => {
      const image = $(element);
      const context = `${image.attr("alt") ?? ""} ${image.attr("class") ?? ""} ${image.parent().attr("class") ?? ""} ${image.parent().attr("id") ?? ""}`;
      if (DECORATIVE_IMAGE_WORDS.test(context)) return;
      const width = Number(image.attr("width") ?? image.attr("data-width") ?? 0);
      const height = Number(image.attr("height") ?? image.attr("data-height") ?? 0);
      if ((width > 0 && width < 180) || (height > 0 && height < 120)) return;
      addImage(image.attr("data-src") || image.attr("data-lazy-src") || image.attr("src"), context);
      if (imageUrls.length >= MAX_ARTICLE_IMAGES) return false;
    });
  });
  const imageUrl = imageUrls[0] ?? null;
  const text = extractSnippet($);
  return { text, imageUrl, imageUrls };
}

async function readLimitedHtml(response: Response): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HTML_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_HTML_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function extractArticlePageData(html: string, pageUrl: string): ArticlePageData {
  return extractPageData(html, pageUrl);
}

/** Best-effort, bounded HTML extraction. Any failure leaves the RSS text/image as fallback. */
export async function fetchArticlePage(rawUrl: string): Promise<ArticlePageData | null> {
  const deadline = Date.now() + ARTICLE_PAGE_BUDGET_MS;
  let currentUrl = toSafeHttpsUrl(rawUrl);
  if (!currentUrl || !(await hasOnlyPublicAddresses(currentUrl, Math.min(DNS_TIMEOUT_MS, deadline - Date.now())))) return null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        headers: {
          "user-agent": "NewsFiestaBot/1.0 (+RSS summarizer; respects publisher access controls)",
          accept: "text/html,application/xhtml+xml;q=0.9",
        },
        signal: AbortSignal.timeout(Math.min(ARTICLE_TIMEOUT_MS, remaining)),
        cache: "no-store",
      });
    } catch {
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirectCount === MAX_REDIRECTS) return null;
      currentUrl = toSafeHttpsUrl(location, currentUrl);
      const redirectBudget = deadline - Date.now();
      if (!currentUrl || redirectBudget <= 0 || !(await hasOnlyPublicAddresses(currentUrl, Math.min(DNS_TIMEOUT_MS, redirectBudget)))) return null;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }

    const html = await readLimitedHtml(response);
    if (!html) return null;
    const page = extractPageData(html, currentUrl);
    const publicImages: string[] = [];
    for (const imageUrl of page.imageUrls) {
      const imageBudget = deadline - Date.now();
      if (imageBudget <= 0) break;
      if (await hasOnlyPublicAddresses(imageUrl, Math.min(DNS_TIMEOUT_MS, imageBudget))) publicImages.push(imageUrl);
    }
    page.imageUrls = publicImages;
    page.imageUrl = publicImages[0] ?? null;
    return page;
  }
  return null;
}
