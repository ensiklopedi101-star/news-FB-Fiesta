import { z } from "zod";
import { isSafePublicImageUrl } from "@/lib/safe-url";

export const MANUAL_REVIEW_MARKER = "popbeez-manual-review-v1";
export const MANUAL_REVIEW_SOURCE_NAME = "Review manual PopBeez";
/** Rows created before the brand capitalisation fix still carry this spelling. */
export const MANUAL_REVIEW_LEGACY_SOURCE_NAMES = ["Review manual Pop" + "beez"];
export const MANUAL_REVIEW_SOURCE_NAMES = [MANUAL_REVIEW_SOURCE_NAME, ...MANUAL_REVIEW_LEGACY_SOURCE_NAMES];
export const MANUAL_REVIEW_FOLLOW_COMMENT = "Ikuti PopBeez untuk rekomendasi film & drama berikutnya: https://www.facebook.com/portalbeez\nFollow juga Instagram PopBeez: https://www.instagram.com/popbeez.hive/";
export const reviewMediaTypes = ["FILM", "DRAMA", "MUSIK"] as const;
export type ReviewMediaType = (typeof reviewMediaTypes)[number];

export type ManualReviewItem = {
  title: string;
  rating: number;
  genre: string;
  reason: string;
  suitableFor: string;
  imageUrl: string;
  /** Required for new drafts; optional only when reading pre-migration reviews. */
  sourceUrl?: string;
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
    // Optional only for reading reviews created before source attribution was added.
    sourceUrl: z.string().url().refine(isSafePublicImageUrl, "Gunakan URL HTTPS publik yang aman.").optional(),
  })).length(5),
});

export function sortManualReviewItems<T extends Pick<ManualReviewItem, "rating">>(items: readonly T[]): T[] {
  return items.map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => b.item.rating - a.item.rating || a.originalIndex - b.originalIndex)
    .map(({ item }) => item);
}

export function createManualReview(value: unknown): ManualReview {
  const input = manualReviewInputSchema.parse(value);
  if (input.items.some((item) => !item.sourceUrl)) {
    throw new Error("Setiap pilihan membutuhkan tautan sumber rating/fakta agar bisa dicantumkan di komentar dan kunci kuis.");
  }
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

export function buildManualReviewSourceList(review: ManualReview): string {
  const sources = review.items
    .map((item, index) => item.sourceUrl ? `${index + 1}. ${item.title}: ${item.sourceUrl}` : null)
    .filter((line): line is string => Boolean(line));
  return sources.length ? `Sumber rating/fakta:\n${sources.join("\n")}` : "";
}

export function buildManualReviewSourceComment(review: ManualReview): string {
  const sources = buildManualReviewSourceList(review);
  return `${sources ? `${sources}\n\n` : ""}${MANUAL_REVIEW_FOLLOW_COMMENT}`;
}

/** A deterministic, source-backed Reel script; it only repeats fields entered by the editor. */
export function buildManualReviewNarration(review: ManualReview): string {
  const typeLabel = review.mediaType.toLocaleLowerCase("id-ID");
  const winner = review.items[0];
  if (!winner) return "";
  return `Beezers, ini lima rekomendasi ${typeLabel} dari PopBeez. Pilihan nomor satu adalah ${winner.title}, rating ${winner.rating.toFixed(1)} dari sepuluh, dengan genre ${winner.genre}. Urutan berikutnya: ${review.items.slice(1).map((item, index) => `nomor ${index + 2}, ${item.title}, rating ${item.rating.toFixed(1)} dari sepuluh`).join("; ")}. Sumber rating dan fakta ada di komentar. Mana yang paling bikin penasaran?`;
}

export function buildManualReviewCaption(review: ManualReview, options: { includeSources?: boolean } = {}): string {
  const rows = review.items.map((item, index) => {
    return `${["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"][index]} ${index === 0 ? "JUARA MINGGU INI: " : ""}${item.title} — ⭐ ${item.rating.toFixed(1)}/10\n• Genre: ${item.genre}${item.reason ? `\n• Kenapa wajib nonton: ${item.reason}` : ""}${item.suitableFor ? `\n• Cocok untuk: ${item.suitableFor}` : ""}`;
  }).join("\n\n");
  const typeLabel = review.mediaType.toLocaleLowerCase("id-ID");
  // Direct Facebook publishing puts sources in the first comment; queued Buffer/Instagram copies can opt into a source block.
  const caption = `🏆 ${review.headline}! 🎬✨\n\nBeezers, bingung mau pilih ${typeLabel} buat ditonton? Ini lima rekomendasi berdasarkan rating yang dicantumkan.\n\n${rows}\n\n💬 Beezers, mana yang paling bikin penasaran? Tulis nomornya di kolom komentar ya! 👇\n\n#Rekomendasi${review.mediaType[0]}${review.mediaType.slice(1).toLowerCase()} #Review${review.mediaType[0]}${review.mediaType.slice(1).toLowerCase()} #WatchlistMingguIni`;
  const sources = options.includeSources ? buildManualReviewSourceList(review) : "";
  return sources ? `${caption}\n\n${sources}` : caption;
}
