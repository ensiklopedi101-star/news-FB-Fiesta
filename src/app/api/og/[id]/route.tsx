import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderOgCard } from "@/lib/og-card";
import { imageForCarouselSlide } from "@/lib/carousel-image";
import { parseManualReview } from "@/lib/manual-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [article] = await getDb().select({ id: articles.id, title: articles.title, category: articles.category, pageKey: articles.pageKey, sourceName: articles.sourceName, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls, sourceUrl: articles.sourceUrl, postFormat: articles.postFormat, carouselSlides: articles.carouselSlides, rawText: articles.rawText, manualImageUrls: articles.manualImageUrls })
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
  const manualReview = parseManualReview(article.rawText);
  const requestedSlide = Number.parseInt(new URL(request.url).searchParams.get("slide") ?? "1", 10);
  const slideTotal = manualReview ? 6 : 4;
  if (!Number.isInteger(requestedSlide) || requestedSlide < 1 || requestedSlide > slideTotal) {
    return new Response("Invalid carousel slide", { status: 400 });
  }
  const carouselLabels = ["FAKTA UTAMA", "RINCIAN BERITA", "IKUT BERBAGI PENDAPAT"];
  const isFollowCtaSlide = !manualReview && isEntertainment && requestedSlide === 4;
  const slide = article.postFormat === "carousel" && !manualReview ? {
    number: requestedSlide,
    total: 4,
    label: isFollowCtaSlide ? "IKUTI POPBEEZ" : requestedSlide === 1 ? "COVER" : carouselLabels[requestedSlide - 2]!,
    ...(requestedSlide > 1 && !isFollowCtaSlide ? { text: article.carouselSlides?.[requestedSlide - 2] ?? "Ringkasan sedang disiapkan." } : {}),
    ...(isFollowCtaSlide ? { isFollowCta: true } : {}),
  } : undefined;
  const reviewSlide = manualReview ? {
    number: requestedSlide,
    total: 6,
    headline: manualReview.headline,
    mediaType: manualReview.mediaType,
    ...(requestedSlide > 1 ? { item: manualReview.items[requestedSlide - 2] } : {}),
  } : undefined;

  try {
    // The cover remains the hero; factual slides use distinct article gallery images when available.
    const requestedImage = manualReview
      ? manualReview.items[requestedSlide === 1 ? 0 : requestedSlide - 2]?.imageUrl ?? article.imageUrl
      : article.postFormat === "carousel"
        ? imageForCarouselSlide(article.imageUrls, article.imageUrl, requestedSlide)
        : article.imageUrl;
    let photoJpeg = await fetchOgImageJpeg(requestedImage, article.sourceUrl, fetch, (reason) => {
      console.warn(`[og-image] Article image rejected for ${article.id}: ${reason}.`);
    });
    let photoJpegSecondary: Uint8Array | null = null;
    if (!manualReview && article.postFormat === "single" && article.manualImageUrls.length === 2 && requestedImage === article.manualImageUrls[0]) {
      photoJpegSecondary = await fetchOgImageJpeg(article.manualImageUrls[1], article.sourceUrl, fetch, (reason) => {
        console.warn(`[og-image] Secondary manual image rejected for ${article.id}: ${reason}.`);
      });
    }
    if (!photoJpeg && requestedImage !== article.imageUrl && article.imageUrl) {
      photoJpeg = await fetchOgImageJpeg(article.imageUrl, article.sourceUrl, fetch, (reason) => {
        console.warn(`[og-image] Cover fallback rejected for ${article.id}: ${reason}.`);
      });
    }

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
      sourceName: article.sourceName,
      isEntertainment,
      photoJpeg,
      photoJpegSecondary,
      slide,
      reviewSlide,
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
