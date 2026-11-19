/**
 * The dashboard shows two lists: what still sits in the local queue ("belum
 * terbit") and everything that already went through the publisher ("sudah
 * terbit"): in-flight, accepted by Buffer, live on Facebook, or failed. Keeping
 * failed/processing rows out of the queue keeps that panel short.
 */
export type ArticleSectionKey = "queue" | "done";

const SECTION_BY_STATUS: Record<string, ArticleSectionKey> = {
  queued: "queue",
  processing: "done",
  ready: "done",
  published: "done",
  failed: "done",
};

/** Returns the section an article belongs to, or null for expired/removed rows that stay hidden. */
export function articleSection(status: string): ArticleSectionKey | null {
  return SECTION_BY_STATUS[status] ?? null;
}

export type ArticleSections<T> = {
  /** Still waiting for the local publisher: numbered #1, #2, … */
  queue: T[];
  /** Processed by a publisher cycle: sent, live, or failed. */
  done: T[];
};

export function splitArticleSections<T extends { status: string }>(articles: readonly T[]): ArticleSections<T> {
  const sections: ArticleSections<T> = { queue: [], done: [] };
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
