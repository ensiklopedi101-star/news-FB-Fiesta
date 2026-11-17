import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderOgCard } from "@/lib/og-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [article] = await getDb().select({ id: articles.id, title: articles.title, caption: articles.caption, category: articles.category, pageKey: articles.pageKey, sourceName: articles.sourceName, imageUrl: articles.imageUrl, sourceUrl: articles.sourceUrl })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return new Response("Not found", { status: 404 });

  const debugImage = new URL(request.url).searchParams.get("debug") === "image";
  const isEntertainment = article.pageKey === "entertainment";
  const brand = (
    (isEntertainment ? process.env.PAGE_BRAND_ENTERTAINMENT : process.env.PAGE_BRAND_NEWS)
    || process.env.PAGE_BRAND
    || (isEntertainment ? "Popbeez" : "Nusabeez")
  ).slice(0, 40);
  const category = article.category.toUpperCase().replace(/[^\p{L}\p{N}\s-]/gu, "").slice(0, 24);

  try {
    const photoJpeg = await fetchOgImageJpeg(article.imageUrl, article.sourceUrl, fetch, (reason) => {
      console.warn(`[og-image] Article image rejected for ${article.id}: ${reason}.`);
    });

    // Diagnostic mode returns the normalized photo bytes directly, without any card rendering.
    if (debugImage) {
      if (!photoJpeg) {
        return new Response("Article image could not be fetched or decoded. Check the Vercel function logs for [og-image].", {
          status: 422,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
        });
      }
      return new Response(new Uint8Array(photoJpeg), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, max-age=0" },
      });
    }

    const card = await renderOgCard({
      brand,
      category,
      title: article.title.slice(0, 130),
      summary: article.caption,
      sourceName: article.sourceName,
      isEntertainment,
      photoJpeg,
    });
    return new Response(new Uint8Array(card), {
      headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error(`[og-image] Card generation failed for article ${article.id}:`, error);
    return new Response("News card generation failed. Check the Vercel function logs for [og-image].", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
    });
  }
}
