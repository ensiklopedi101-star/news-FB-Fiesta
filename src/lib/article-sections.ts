/**
 * Dashboard queues are shown as two lists: what still has to leave the
 * dashboard ("belum terbit") and what has already left it ("sudah terbit").
 * `ready` counts as done because Buffer accepted the post and publishes it on
 * the channel schedule; only the direct Facebook path flips to `published`.
 * These helpers keep that decision in one place.
 */
export type ArticleSectionKey = "queue" | "sending" | "failed" | "done";

const SECTION_BY_STATUS: Record<string, ArticleSectionKey> = {
  queued: "queue",
  processing: "sending",
  failed: "failed",
  ready: "done",
  published: "done",
};

/** Returns the section an article belongs to, or null for expired/removed rows that stay hidden. */
export function articleSection(status: string): ArticleSectionKey | null {
  return SECTION_BY_STATUS[status] ?? null;
}

export type ArticleSections<T> = {
  /** Still waiting for the local publisher: numbered #1, #2, … */
  queue: T[];
  /** Being processed right now by a publisher cycle. */
  sending: T[];
  /** Attempts exhausted; needs a manual retry or removal. */
  failed: T[];
  /** Left the dashboard: live on Facebook, or accepted by Buffer and waiting for its slot. */
  done: T[];
};

export function splitArticleSections<T extends { status: string }>(articles: readonly T[]): ArticleSections<T> {
  const sections: ArticleSections<T> = { queue: [], sending: [], failed: [], done: [] };
  for (const article of articles) {
    const section = articleSection(article.status);
    if (section) sections[section].push(article);
  }
  return sections;
}

/** Live on the Facebook Page right now; `ready` rows only sit in the Buffer queue. */
export function isLivePost(status: string): boolean {
  return status === "published";
}

/**
 * Permalink for a Facebook post id. Direct publishing stores the raw post id
 * (`<pageId>_<postId>`), while Buffer rows store `buffer:<id>` and can only be
 * opened from Buffer itself.
 */
export function facebookPostUrl(facebookPostId: string | null | undefined): string | null {
  const value = facebookPostId?.trim();
  if (!value || !/^[0-9]+(_[0-9]+)?$/.test(value)) return null;
  return `https://www.facebook.com/${value}`;
}
