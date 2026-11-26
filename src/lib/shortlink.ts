import "server-only";
import { getDb } from "@/lib/db";
import { shortLinks } from "@/lib/schema";
import { buildShortlink, shortlinkBaseUrl, shortlinkSlugFor } from "@/lib/shortlink-core";

/**
 * Store (or reuse) a short link on our own domain. If the table or base URL is
 * missing, the original URL is returned so publishing never breaks.
 */
export async function shortenArticleUrl(targetUrl: string, articleId?: string | null): Promise<string> {
  const baseUrl = shortlinkBaseUrl();
  if (!baseUrl) return targetUrl;
  const slug = shortlinkSlugFor(targetUrl);
  try {
    await getDb()
      .insert(shortLinks)
      .values({ slug, targetUrl, articleId: articleId ?? null })
      .onConflictDoNothing();
    return buildShortlink(baseUrl, slug);
  } catch (error) {
    console.error("[shortlink] Gagal menyimpan tautan pendek:", error instanceof Error ? error.message : error);
    return targetUrl;
  }
}
