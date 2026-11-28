import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderOgCard } from "@/lib/og-card";
import { imageForCarouselSlide } from "@/lib/carousel-image";
import { selectedRoundupImage } from "@/lib/roundup";
import { manualImageReferer, parseManualReview } from "@/lib/manual-review";
import { parseArtistBio } from "@/lib/artist-bio";
import { isKnownAggregatorBrandImage } from "@/lib/safe-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [article] = await getDb().select({ id: articles.id, title: articles.title, category: articles.category, pageKey: articles.pageKey, sourceName: articles.sourceName, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls, sourceUrl: articles.sourceUrl, postFormat: articles.postFormat, carouselSlides: articles.carouselSlides, rawText: articles.rawText, manualImageUrls: articles.manualImageUrls })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  if (!article) return new Response("Not found", { status: 404 });

  const searchParams = new URL(request.url).searchParams;
  const rawRoundupIds = searchParams.get("roundupIds");
  const roundupIds = rawRoundupIds ? rawRoundupIds.split(",") : null;
  if (roundupIds && (roundupIds.length < 4 || roundupIds.length > 5 || !roundupIds.includes(id) || roundupIds.some((storyId) => !/^[0-9a-f-]{36}$/i.test(storyId)))) {
    return new Response("Invalid roundup articles", { status: 400 });
  }
  const roundupStories = roundupIds ? await getDb().select({ id: articles.id, title: articles.title, category: articles.category, pageKey: articles.pageKey, sourceName: articles.sourceName, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls, sourceUrl: articles.sourceUrl, postFormat: articles.postFormat, carouselSlides: articles.carouselSlides, rawText: articles.rawText, manualImageUrls: articles.manualImageUrls })
    .from(articles).where(inArray(articles.id, roundupIds)) : [];
  if (roundupIds && (roundupStories.length !== roundupIds.length || roundupStories.some((story) => story.pageKey !== "entertainment"))) {
    return new Response("Roundup stories unavailable", { status: 404 });
  }
  const roundIndex = roundupIds?.indexOf(id) ?? -1;
  const cardArticle = roundupIds && roundIndex >= 0
    ? roundupStories.find((story) => story.id === roundupIds[Number.parseInt(searchParams.get("slide") ?? "1", 10) - 1]) ?? article
    : article;

  const debugImage = searchParams.get("debug") === "image";
  const localizedRoundupTitle = roundupIds ? searchParams.get("roundupTitle")?.replace(/\*+/g, "").trim() : null;
  const displayTitle = (localizedRoundupTitle || cardArticle.title).replace(/\*+/g, "").trim();
  const isEntertainment = cardArticle.pageKey === "entertainment";
  const brand = (
    (isEntertainment ? process.env.PAGE_BRAND_ENTERTAINMENT : process.env.PAGE_BRAND_NEWS)
    || process.env.PAGE_BRAND
    || (isEntertainment ? "PopBeez" : "Nusabeez")
  ).slice(0, 40);
  const category = cardArticle.category.toUpperCase().replace(/[^\p{L}\p{N}\s-]/gu, "").slice(0, 24);
  const manualReview = roundupIds ? null : parseManualReview(cardArticle.rawText);
  const artistBio = roundupIds ? null : parseArtistBio(cardArticle.rawText);
  const requestedSlide = Number.parseInt(searchParams.get("slide") ?? "1", 10);
  const slideTotal = roundupIds?.length ?? (manualReview ? 6 : artistBio ? artistBio.facts.length : 4);
  if (!Number.isInteger(requestedSlide) || requestedSlide < 1 || requestedSlide > slideTotal) {
    return new Response("Invalid carousel slide", { status: 400 });
  }
  const carouselLabels = ["FAKTA UTAMA", "RINCIAN BERITA", "IKUT BERBAGI PENDAPAT"];
  // New image fields from the feed occasionally carry the rss.app placeholder again,
  // so stored rows are re-checked at render time instead of trusting the database.
  const isFollowCtaSlide = !roundupIds && !manualReview && !artistBio && isEntertainment && requestedSlide === 4;
  // Roundup slides show only the catchy localized headline in cover typography,
  // never a combined "headline — summary" paragraph on top of the photo.
  const slide = artistBio ? {
    number: requestedSlide,
    total: artistBio.facts.length,
    label: `FAKTA ${requestedSlide}`,
    text: `${artistBio.name}\n${artistBio.facts[requestedSlide - 1]?.fact ?? "Fakta tidak tersedia."}`,
  } : roundupIds ? {
    number: requestedSlide,
    total: roundupIds.length,
    label: `BERITA ${requestedSlide}`,
  } : article.postFormat === "carousel" && !manualReview ? {
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
    // The review cover is a plain pink slide; ranked cards use their own posters.
    const plainReviewCover = manualReview !== null && requestedSlide === 1;
    const requestedImage = plainReviewCover
      ? null
      : manualReview
        ? manualReview.items[requestedSlide - 2]?.imageUrl ?? cardArticle.imageUrl
        : artistBio
          ? artistBio.facts[requestedSlide - 1]?.imageUrl ?? cardArticle.imageUrl
          : roundupIds
            ? selectedRoundupImage(cardArticle)
            : cardArticle.postFormat === "carousel"
              ? imageForCarouselSlide(cardArticle.imageUrls, cardArticle.imageUrl, requestedSlide)
              : cardArticle.imageUrl;
    const safeRequestedImage = isKnownAggregatorBrandImage(requestedImage) ? null : requestedImage;
    const imageReferer = (manualReview || artistBio) && safeRequestedImage ? manualImageReferer(safeRequestedImage) : cardArticle.sourceUrl;
    let imageFailure = "";
    const reportImageFailure = (reason: string) => {
      imageFailure = reason;
      console.warn(`[og-image] Article image rejected for ${article.id}: ${reason}.`);
    };
    let photoJpeg = plainReviewCover
      ? null
      : await fetchOgImageJpeg(safeRequestedImage, imageReferer, fetch, reportImageFailure);
    // Some publishers reject every cross-origin Referer; retry anonymously before giving up on a manual image.
    if (!photoJpeg && (manualReview || artistBio) && safeRequestedImage) {
      photoJpeg = await fetchOgImageJpeg(safeRequestedImage, "", fetch, (reason) => {
        imageFailure = reason;
        console.warn(`[og-image] Manual image rejected without Referer for ${article.id}: ${reason}.`);
      });
    }
    let photoJpegSecondary: Uint8Array | null = null;
    if (!manualReview && !artistBio && article.postFormat === "single" && article.manualImageUrls.length === 2 && requestedImage === article.manualImageUrls[0]) {
      photoJpegSecondary = await fetchOgImageJpeg(article.manualImageUrls[1], article.sourceUrl, fetch, (reason) => {
        console.warn(`[og-image] Secondary manual image rejected for ${article.id}: ${reason}.`);
      });
    }
    if (!plainReviewCover && !photoJpeg && requestedImage !== cardArticle.imageUrl && cardArticle.imageUrl) {
      photoJpeg = await fetchOgImageJpeg(cardArticle.imageUrl, manualReview ? manualImageReferer(cardArticle.imageUrl) : cardArticle.sourceUrl, fetch, (reason) => {
        console.warn(`[og-image] Cover fallback rejected for ${cardArticle.id}: ${reason}.`);
      });
    }

    // Diagnostic mode returns the normalized photo bytes directly, without any card rendering.
    if (debugImage) {
      if (plainReviewCover) {
        return new Response("Slide 1 adalah cover pink tanpa foto sumber.", {
          status: 422,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
        });
      }
      if (!photoJpeg) {
        return new Response(`Article image could not be fetched or decoded (${imageFailure || "unknown reason"}). Check the Vercel function logs for [og-image].`, {
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
      title: displayTitle.slice(0, 130),
      sourceName: cardArticle.sourceName,
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
