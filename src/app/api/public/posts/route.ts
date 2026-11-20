import { and, desc, eq, inArray, isNotNull, notLike, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { articles, shortLinks } from "@/lib/schema";

import { isKnownAggregatorBrandImage } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public read-only feed of everything already published to Facebook (and mirrored
 * to Instagram). The landing page only has to fetch this endpoint — there is no
 * build-time coupling, so new posts show up within a minute.
 *
 * GET /api/public/posts?page=entertainment|news&limit=12
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function plainExcerpt(caption: string | null): string {
  if (!caption) return "";
  const withoutTail = caption.split(/\n\s*\n\s*(?:📰|🔗|Ikuti PopBeez)/)[0] ?? caption;
  return withoutTail.replace(/\s+/g, " ").trim().slice(0, 220);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const page = url.searchParams.get("page");
    const requestedLimit = Number.parseInt(url.searchParams.get("limit") ?? "12", 10);
    const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 30) : 12;
    const appUrl = (process.env.APP_URL?.trim() || "https://portal-beez.vercel.app").replace(/\/+$/, "");

    const filters = [
      eq(articles.status, "published"),
      isNotNull(articles.facebookPostId),
      notLike(articles.facebookPostId, "buffer:pending:%"),
      notLike(articles.facebookPostId, "facebook:pending:%"),
      notLike(articles.sourceName, "Review manual Popbeez"),
      notLike(articles.sourceName, "Review manual PopBeez"),
    ];
    if (page === "news" || page === "entertainment") filters.push(eq(articles.pageKey, page));

    const rows = await getDb()
      .select({
        id: articles.id,
        title: articles.title,
        caption: articles.caption,
        category: articles.category,
        pageKey: articles.pageKey,
        sourceName: articles.sourceName,
        sourceUrl: articles.sourceUrl,
        imageUrl: articles.imageUrl,
        postFormat: articles.postFormat,
        instagramMediaId: articles.instagramMediaId,
        facebookPostId: articles.facebookPostId,
        publishedAt: articles.publishedAt,
        updatedAt: articles.updatedAt,
      })
      .from(articles)
      .where(and(...filters))
      .orderBy(desc(sql`coalesce(${articles.publishedAt}, ${articles.updatedAt})`))
      .limit(limit);

    const ids = rows.map((row) => row.id);
    const links = ids.length
      ? await getDb()
        .select({ articleId: shortLinks.articleId, slug: shortLinks.slug })
        .from(shortLinks)
        .where(inArray(shortLinks.articleId, ids))
      : [];
    const slugByArticle = new Map(links.map((link) => [link.articleId, link.slug]));

    const posts = rows.map((row) => {
      const slideCount = row.postFormat === "carousel" ? 4 : 1;
      const images = Array.from({ length: slideCount }, (_, index) =>
        `${appUrl}/api/og/${row.id}${slideCount > 1 ? `?slide=${index + 1}` : ""}`);
      const directFacebook = row.facebookPostId && !row.facebookPostId.startsWith("buffer:");
      const slug = slugByArticle.get(row.id);
      return {
        id: row.id,
        title: row.title,
        excerpt: plainExcerpt(row.caption),
        category: row.category,
        pageKey: row.pageKey,
        sourceName: row.sourceName,
        image: images[0],
        images,
        imageUrl: isKnownAggregatorBrandImage(row.imageUrl) ? null : row.imageUrl,
        facebookUrl: directFacebook ? `https://www.facebook.com/${row.facebookPostId}` : null,
        instagramUrl: row.instagramMediaId ? `https://www.instagram.com/p/${row.instagramMediaId}/` : null,
        shortUrl: slug ? `${appUrl}/s/${slug}` : null,
        sourceUrl: row.sourceUrl,
        publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
      };
    });

    return NextResponse.json(
      { ok: true, count: posts.length, generatedAt: new Date().toISOString(), posts },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    console.error("[public-posts] gagal:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "Feed publik sementara tidak tersedia." }, { status: 500, headers: CORS_HEADERS });
  }
}
