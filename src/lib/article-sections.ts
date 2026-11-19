/**
 * Dashboard queues are shown as two separate lists: what has already been
 * published and what is still waiting to be published. These helpers keep the
 * grouping in one place so the API and the dashboard never disagree.
 */
export type ArticleSectionKey = "queue" | "waiting" | "failed" | "published";

const SECTION_BY_STATUS: Record<string, ArticleSectionKey> = {
  queued: "queue",
  processing: "waiting",
  ready: "waiting",
  failed: "failed",
  published: "published",
};

/** Returns the section an article belongs to, or null for expired/removed rows that stay hidden. */
export function articleSection(status: string): ArticleSectionKey | null {
  return SECTION_BY_STATUS[status] ?? null;
}

export type ArticleSections<T> = {
  /** Still waiting for the local publisher: numbered #1, #2, … */
  queue: T[];
  /** Already handed to Buffer/Facebook: has `ready`/`processing` status and waits for its slot. */
  waiting: T[];
  /** Attempts exhausted; needs a manual retry or removal. */
  failed: T[];
  /** Live on the Facebook Page. */
  published: T[];
};

export function splitArticleSections<T extends { status: string }>(articles: readonly T[]): ArticleSections<T> {
  const sections: ArticleSections<T> = { queue: [], waiting: [], failed: [], published: [] };
  for (const article of articles) {
    const section = articleSection(article.status);
    if (section) sections[section].push(article);
  }
  return sections;
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
