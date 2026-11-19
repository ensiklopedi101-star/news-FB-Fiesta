import { createHash } from "node:crypto";

/** Deterministic slug so the same source URL keeps one short link and one click count. */
export function shortlinkSlugFor(targetUrl: string): string {
  return createHash("sha256").update(targetUrl).digest("hex").slice(0, 8);
}

/**
 * Short links render on the app deployment itself. Point a custom domain at the
 * same Vercel project and set SHORTLINK_BASE_URL to use it instead of APP_URL.
 */
export function shortlinkBaseUrl(): string | null {
  const raw = process.env.SHORTLINK_BASE_URL?.trim() || process.env.APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function buildShortlink(baseUrl: string, slug: string): string {
  return `${baseUrl}/s/${slug}`;
}
