import { z } from "zod";
import { isSafePublicImageUrl } from "@/lib/safe-url";

export const MANUAL_REVIEW_MARKER = "popbeez-manual-review-v1";
export const MANUAL_REVIEW_SOURCE_NAME = "Review manual Popbeez";
export const MANUAL_REVIEW_FOLLOW_COMMENT = "Ikuti Popbeez untuk rekomendasi film & drama berikutnya: https://www.facebook.com/portalbeez";
export const reviewMediaTypes = ["FILM", "DRAMA", "MUSIK"] as const;
export type ReviewMediaType = (typeof reviewMediaTypes)[number];

export type ManualReviewItem = {
  title: string;
  rating: number;
  genre: string;
  reason: string;
  suitableFor: string;
  imageUrl: string;
};

export type ManualReview = {
  kind: typeof MANUAL_REVIEW_MARKER;
  headline: string;
  mediaType: ReviewMediaType;
  items: ManualReviewItem[];
};

const imageUrlSchema = z.string().url().refine(isSafePublicImageUrl, "Gunakan URL gambar publik HTTPS.");
export const manualReviewInputSchema = z.object({
  headline: z.string().trim().min(5).max(100),
  mediaType: z.enum(reviewMediaTypes),
  items: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    rating: z.number().min(0).max(10),
    genre: z.string().trim().min(1).max(100),
    reason: z.string().trim().max(240).default(""),
    suitableFor: z.string().trim().max(160).default(""),
    imageUrl: imageUrlSchema,
  })).length(5),
});

export function sortManualReviewItems<T extends Pick<ManualReviewItem, "rating">>(items: readonly T[]): T[] {
  return items.map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => b.item.rating - a.item.rating || a.originalIndex - b.originalIndex)
    .map(({ item }) => item);
}

export function createManualReview(value: unknown): ManualReview {
  const input = manualReviewInputSchema.parse(value);
  return {
    kind: MANUAL_REVIEW_MARKER,
    headline: input.headline,
    mediaType: input.mediaType,
    items: sortManualReviewItems(input.items),
  };
}

export function parseManualReview(rawText: string): ManualReview | null {
  try {
    const value = JSON.parse(rawText) as Partial<ManualReview>;
    if (value.kind !== MANUAL_REVIEW_MARKER || !value.headline || !value.mediaType || !Array.isArray(value.items) || value.items.length !== 5) return null;
    const parsed = manualReviewInputSchema.safeParse(value);
    return parsed.success
      ? { kind: MANUAL_REVIEW_MARKER, headline: parsed.data.headline, mediaType: parsed.data.mediaType, items: sortManualReviewItems(parsed.data.items) }
      : null;
  } catch {
    return null;
  }
}

/** Choose a useful publisher Referer for user-supplied image URLs instead of pretending Facebook sourced them. */
export function manualImageReferer(imageUrl: string): string {
  const image = new URL(imageUrl);
  const host = image.hostname.toLowerCase();
  if (host === "soompi.io" || host.endsWith(".soompi.io")) return "https://www.soompi.com/";
  // Jetpack/Photon proxies keep the upstream host as the first path segment.
  if (/^i[0-3]\.wp\.com$/.test(host)) {
    const upstream = image.pathname.split("/").find(Boolean);
    if (upstream && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(upstream)) return `https://${upstream}/`;
  }
  return `${image.origin}/`;
}

export function buildManualReviewCaption(review: ManualReview): string {
  const rows = review.items.map((item, index) => {
    return `${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][index]} ${index === 0 ? "JUARA MINGGU INI: " : ""}${item.title} — ⭐ ${item.rating.toFixed(1)}/10\n• Genre: ${item.genre}${item.reason ? `\n• Kenapa wajib nonton: ${item.reason}` : ""}${item.suitableFor ? `\n• Cocok untuk: ${item.suitableFor}` : ""}`;
  }).join("\n\n");
  const typeLabel = review.mediaType.toLocaleLowerCase("id-ID");
  // No links in the caption: the follow link goes into the first comment instead.
  return `🏆 ${review.headline}! 🎬✨\n\nBingung mau pilih ${typeLabel} untuk ditonton? Ini lima rekomendasi berdasarkan rating yang dicantumkan.\n\n${rows}\n\n💬 Mana yang paling bikin penasaran? Tulis nomornya di kolom komentar ya! 👇\n\n#Rekomendasi${review.mediaType[0]}${review.mediaType.slice(1).toLowerCase()} #Review${review.mediaType[0]}${review.mediaType.slice(1).toLowerCase()} #WatchlistMingguIni`;
}
