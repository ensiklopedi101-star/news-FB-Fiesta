import { timingSafeEqual } from "node:crypto";
import { createReadOnlyJsonHandler, readApiJson, type createReadApiRateLimiter } from "./read-only-api";
import { isSafePublicImageUrl } from "./safe-url";

export type HiveCompBrand = "popbeez" | "nusabeez";
export type HiveCompRouteContext = { params: Promise<{ brand: string }> };

// Only public content is selected; no source URL, raw text, errors or credentials.
export type PublicArticle = {
  id: string;
  title: string;
  caption: string | null;
  imageUrl: string | null;
  publishedAt: Date | null;
};

export type HiveCompPost = {
  id: string;
  message: string;
  full_picture?: string;
  created_time?: string;
};

export function parseHiveCompBrand(raw: string): HiveCompBrand | null {
  return raw === "popbeez" || raw === "nusabeez" ? raw : null;
}

export function isHiveCompAuthorized(authorization: string | null, expectedToken: string): boolean {
  if (!expectedToken.trim() || !authorization) return false;
  const match = authorization.trim().match(/^Bearer\s+(\S+)$/i);
  if (!match) return false;

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(match[1]);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export function parseHiveCompLimit(raw: string | null): number {
  if (raw === null || !/^\d+$/.test(raw)) return 3;
  const requested = Number(raw);
  if (!Number.isSafeInteger(requested) || requested < 1) return 3;
  return Math.min(requested, 3);
}

function publicMessage(raw: string, secrets: readonly string[]): string {
  let message = raw;
  for (const secret of secrets) {
    if (secret) message = message.replaceAll(secret, "[redacted]").replaceAll(encodeURIComponent(secret), "[redacted]");
  }
  return message
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/([?&](?:access[_-]?token|token|api[_-]?key|key|secret|password|email|phone)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/(?<![\p{L}\p{N}])\+?\d[\d ().-]{7,}\d(?![\p{L}\p{N}])/gu, (candidate) => {
      // Preserve ISO dates; conservatively redact phone-like 9–15 digit strings.
      if (/^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(candidate)) return candidate;
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 9 && digits.length <= 15 ? "[redacted]" : candidate;
    });
}

function isPublicAssetUrl(raw: string | null | undefined, secrets: readonly string[]): raw is string {
  if (!isSafePublicImageUrl(raw)) return false;
  const url = new URL(raw);
  if (url.hash || secrets.some((secret) => secret && (raw.includes(secret) || raw.includes(encodeURIComponent(secret))))) return false;
  return ![...url.searchParams.keys()].some((key) =>
    /token|secret|password|credential|signature|api[_-]?key|authorization|^(?:key|email|phone|tel|auth)$/i.test(key),
  );
}

export function getHiveCompCardUrl(articleId: string, appUrl: string | undefined): string | undefined {
  if (!isSafePublicImageUrl(appUrl)) return undefined;
  return new URL(`/api/og/${encodeURIComponent(articleId)}`, appUrl).toString();
}

export function toHiveCompPost(
  article: PublicArticle,
  cardUrl?: string,
  secrets: readonly string[] = [],
): HiveCompPost | null {
  const message = publicMessage(article.caption?.trim() || article.title.trim(), secrets);
  if (!article.id.trim() || !message) return null;

  const post: HiveCompPost = { id: article.id, message };
  // created_at is ingestion time, not Facebook publication time. Never substitute it.
  if (article.publishedAt && Number.isFinite(article.publishedAt.getTime())) {
    post.created_time = article.publishedAt.toISOString();
  }
  if (isPublicAssetUrl(cardUrl, secrets)) post.full_picture = cardUrl;
  else if (isPublicAssetUrl(article.imageUrl, secrets)) post.full_picture = article.imageUrl;
  // Permalinks and engagement counts are not stored. Do not synthesize them.
  return post;
}

type HiveCompDependencies = {
  getToken: () => string | undefined;
  getAppUrl: () => string | undefined;
  loadPosts: (brand: HiveCompBrand, limit: number, signal: AbortSignal) => Promise<PublicArticle[]>;
  rateLimiter?: ReturnType<typeof createReadApiRateLimiter>;
  timeoutMs?: number;
};

export function createHiveCompPostsHandler(dependencies: HiveCompDependencies) {
  const error = (code: string, status: number, headers?: HeadersInit) =>
    readApiJson({ items: [], error: code }, status, headers);

  return createReadOnlyJsonHandler<HiveCompRouteContext>(async (request, { params }, signal) => {
    const token = dependencies.getToken()?.trim();
    if (!token) return error("server_configuration_error", 500);
    if (!isHiveCompAuthorized(request.headers.get("authorization"), token)) {
      return error("unauthorized", 401, { "WWW-Authenticate": 'Bearer realm="hivecomp"' });
    }

    const { brand: rawBrand } = await params;
    const brand = parseHiveCompBrand(rawBrand);
    if (!brand) return error("brand_not_found", 404);

    const limit = parseHiveCompLimit(new URL(request.url).searchParams.get("limit"));
    const rows = await dependencies.loadPosts(brand, limit, signal);
    const appUrl = dependencies.getAppUrl();
    const items = rows.slice(0, limit).flatMap((article) => {
      const post = toHiveCompPost(article, getHiveCompCardUrl(article.id, appUrl), [token]);
      return post ? [post] : [];
    });
    return readApiJson({ items }, 200, {
      "Cache-Control": "public, max-age=300",
      Vary: "Authorization",
    });
  }, {
    errorBody: (code) => ({ items: [], error: code }),
    rateLimiter: dependencies.rateLimiter,
    timeoutMs: dependencies.timeoutMs,
  });
}
