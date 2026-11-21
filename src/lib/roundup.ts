import type { Pillar } from "@/lib/pillars";
import { isKnownAggregatorBrandImage, isSafePublicImageUrl } from "@/lib/safe-url";

export const POPBEEZ_ROUNDUP_MIN = 4;
export const POPBEEZ_ROUNDUP_MAX = 5;

export type RoundupCandidate = { id: string; pillar: Pillar };

export function selectedRoundupImage(article: {
  imageUrl: string | null;
  imageUrls?: string[] | null;
  manualImageUrls?: string[] | null;
}): string | null {
  const candidates = [article.manualImageUrls?.[0], article.imageUrl, article.imageUrls?.[0]];
  return candidates.find((url): url is string => isSafePublicImageUrl(url) && !isKnownAggregatorBrandImage(url)) ?? null;
}

/**
 * Select four or five queued stories. Pillar diversity is a soft preference only:
 * whenever there is a choice, prefer an unused pillar, but never reject a valid
 * roundup merely because its stories share a pillar. Input order is editorial
 * priority; the returned order is the exact image/caption/source order.
 */
export function roundupSlideUrls(appUrl: string, leadId: string, articleIds: readonly string[]): string[] {
  if (articleIds.length < POPBEEZ_ROUNDUP_MIN || articleIds.length > POPBEEZ_ROUNDUP_MAX || articleIds[0] !== leadId) {
    throw new Error("Roundup image URLs require four or five ordered article IDs with the lead first.");
  }
  const orderedIds = articleIds.join(",");
  return articleIds.map((_, index) => {
    const query = new URLSearchParams({ roundupIds: orderedIds, slide: String(index + 1) });
    return `${appUrl.replace(/\/$/, "")}/api/og/${leadId}?${query.toString()}`;
  });
}

export function selectRoundup<T extends RoundupCandidate>(candidates: readonly T[]): T[] | null {
  if (candidates.length <= 2) return candidates.length ? [candidates[0]!] : [];
  if (candidates.length < POPBEEZ_ROUNDUP_MIN) return null;

  const target = Math.min(POPBEEZ_ROUNDUP_MAX, candidates.length);
  const chosen: T[] = [];
  const remaining = [...candidates];
  while (chosen.length < target) {
    const used = new Set(chosen.map((item) => item.pillar));
    const diverseIndex = remaining.findIndex((item) => !used.has(item.pillar));
    const index = diverseIndex >= 0 ? diverseIndex : 0;
    chosen.push(remaining.splice(index, 1)[0]!);
  }
  return chosen;
}
