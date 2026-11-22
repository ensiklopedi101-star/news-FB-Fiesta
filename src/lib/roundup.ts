import type { Pillar } from "@/lib/pillars";
import { isKnownAggregatorBrandImage, isSafePublicImageUrl } from "@/lib/safe-url";

export const POPBEEZ_ROUNDUP_MIN = 4;
export const POPBEEZ_ROUNDUP_MAX = 4;

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
 * Select exactly four queued stories for a full-size PopBeez carousel. Fewer than
 * four eligible stories wait; extra stories stay queued for later. Pillar diversity
 * is only a soft preference. Input order is editorial priority and stays aligned
 * across each image, caption summary, headline, and source.
 */
export function roundupSlideUrls(appUrl: string, leadId: string, articleIds: readonly string[]): string[] {
  if (articleIds.length !== POPBEEZ_ROUNDUP_MIN || articleIds[0] !== leadId) {
    throw new Error("Roundup image URLs require exactly four ordered article IDs with the lead first.");
  }
  const orderedIds = articleIds.join(",");
  return articleIds.map((_, index) => {
    const query = new URLSearchParams({ roundupIds: orderedIds, slide: String(index + 1) });
    return `${appUrl.replace(/\/$/, "")}/api/og/${leadId}?${query.toString()}`;
  });
}

export function selectRoundup<T extends RoundupCandidate>(candidates: readonly T[]): T[] | null {
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
