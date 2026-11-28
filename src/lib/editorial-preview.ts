import "server-only";
import { Buffer } from "node:buffer";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderOgCard } from "@/lib/og-card";
import { manualImageReferer, MANUAL_REVIEW_SOURCE_NAME, type ManualReview } from "@/lib/manual-review";
import { ARTIST_BIO_SOURCE_NAME, type ArtistBio } from "@/lib/artist-bio";

function brandName(): string {
  return (process.env.PAGE_BRAND_ENTERTAINMENT?.trim() || process.env.PAGE_BRAND?.trim() || "PopBeez").slice(0, 40);
}

export async function renderManualReviewPreview(review: ManualReview): Promise<Buffer[]> {
  const posterImages = await Promise.all(review.items.map(async (item) => {
    const image = await fetchOgImageJpeg(item.imageUrl, manualImageReferer(item.imageUrl));
    if (!image) throw new Error(`Foto poster “${item.title}” tidak bisa dibaca. Periksa tautan lalu coba pratinjau lagi.`);
    return image;
  }));

  return Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const number = index + 1;
    return renderOgCard({
      brand: brandName(),
      category: review.mediaType,
      title: review.headline,
      sourceName: MANUAL_REVIEW_SOURCE_NAME,
      isEntertainment: true,
      photoJpeg: number === 1 ? null : posterImages[number - 2]!,
      reviewSlide: {
        number,
        total: 6,
        headline: review.headline,
        mediaType: review.mediaType,
        ...(number > 1 ? { item: review.items[number - 2] } : {}),
      },
    });
  }));
}

export async function renderArtistBioPreview(bio: ArtistBio): Promise<Buffer[]> {
  const photos = await Promise.all(bio.facts.map(async (item, index) => {
    const image = await fetchOgImageJpeg(item.imageUrl, manualImageReferer(item.imageUrl));
    if (!image) throw new Error(`Foto ${index + 1} untuk ${bio.name} tidak bisa dibaca. Periksa tautan lalu coba pratinjau lagi.`);
    return image;
  }));

  return Promise.all(bio.facts.map(async (item, index) => renderOgCard({
    brand: brandName(),
    category: "ARTIS BIO",
    title: `Kenalan dengan ${bio.name}`,
    sourceName: ARTIST_BIO_SOURCE_NAME,
    isEntertainment: true,
    photoJpeg: photos[index]!,
    slide: {
      number: index + 1,
      total: bio.facts.length,
      label: `FAKTA ${index + 1}`,
      text: `${bio.name}\n${item.fact}`,
    },
  })));
}

export function previewDataUrls(images: readonly Uint8Array[]): string[] {
  return images.map((image) => `data:image/jpeg;base64,${Buffer.from(image).toString("base64")}`);
}
