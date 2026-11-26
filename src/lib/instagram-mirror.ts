/**
 * Pure helpers for re-mirroring posts that already went out on Facebook to
 * Instagram. Kept free of `server-only` so the rules can be unit-tested.
 *
 * A mirrored post must reuse the *same* card URLs Facebook used (`/api/og/<id>`),
 * because those are the only public JPEGs carrying the brand, the HIVECOMP credit
 * and the Instagram CTA.
 */
export type MirrorableArticle = {
  id: string;
  status: string;
  pageKey: string;
  sourceName: string;
  postFormat: string;
  caption: string | null;
  facebookPostId: string | null;
  instagramMediaId?: string | null;
};

const MANUAL_REVIEW_PATTERN = /^review manual popbeez$/i;
const INSTAGRAM_CAPTION_LIMIT = 2_200;

export function isManualReviewArticle(article: Pick<MirrorableArticle, "sourceName">): boolean {
  return MANUAL_REVIEW_PATTERN.test(article.sourceName.trim());
}

/** Manual reviews have six slides, other carousels four, single posts one. */
export function mirrorSlideCount(article: Pick<MirrorableArticle, "id" | "postFormat" | "sourceName">): number {
  if (article.postFormat !== "carousel") return 1;
  return isManualReviewArticle(article) ? 6 : 4;
}

export function mirrorImageUrls(
  article: Pick<MirrorableArticle, "id" | "postFormat" | "sourceName">,
  appUrl: string,
): string[] {
  const base = appUrl.replace(/\/+$/, "");
  const slides = mirrorSlideCount(article);
  if (slides === 1) return [`${base}/api/og/${article.id}`];
  return Array.from({ length: slides }, (_, index) => `${base}/api/og/${article.id}?slide=${index + 1}`);
}

/**
 * Why a row cannot be mirrored. Only posts that are already live on Facebook
 * qualify: re-mirroring queued work would publish it twice on Instagram later.
 */
export function mirrorEligibility(
  article: Pick<MirrorableArticle, "status" | "pageKey" | "facebookPostId" | "instagramMediaId">,
  options: { force?: boolean } = {},
): { ok: boolean; reason: string } {
  if (article.status !== "published") return { ok: false, reason: "Belum tayang di Facebook." };
  if (!article.facebookPostId || article.facebookPostId.includes("pending")) {
    return { ok: false, reason: "Post Facebook belum punya ID pasti (masih pending)." };
  }
  if (article.instagramMediaId && !options.force) return { ok: false, reason: "Sudah ada di Instagram." };
  return { ok: true, reason: "Siap dicerminkan." };
}

/**
 * Instagram captions are plain text: keep the copy intact but trim to the 2 200
 * character limit and drop the duplicated source line when it already says the
 * same thing twice.
 */
export function instagramCaption(caption: string | null): string {
  const text = (caption ?? "").trim();
  if (!text) return "";
  return text.slice(0, INSTAGRAM_CAPTION_LIMIT);
}
