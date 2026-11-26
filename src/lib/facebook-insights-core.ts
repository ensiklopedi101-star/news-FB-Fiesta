import type { Pillar } from "@/lib/pillars";

export type FacebookPostMetrics = {
  /** `post_media_view`: every time Meta played or displayed the post. */
  mediaViews: number;
  /** `post_total_media_view_unique`: distinct media viewers. */
  uniqueViewers: number;
  /** `post_clicks`: clicks anywhere on the Facebook post, not short-link clicks. */
  clicks: number;
  /** Sum of Meta's per-reaction-type totals. */
  reactions: number;
  /** Facebook Post object's comment summary count. */
  comments: number;
  /** Facebook Post object's shares count. */
  shares: number;
  /** Optional video metric; non-video posts normally report zero. */
  videoViews: number;
};

export type FacebookPillarPerformance = {
  pillar: Pillar;
  /** Posts with a complete reactions + comments + shares sample. */
  posts: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number;
};

export type FacebookSlotPerformance = {
  slotLabel: string;
  /** Posts with a complete reactions + comments + shares sample. */
  posts: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number;
};

export type FacebookPostPerformance = FacebookPostMetrics & {
  facebookPostId: string;
  title: string;
  pillar: Pillar | null;
  slotLabel: string | null;
  publishedAt: string | null;
  syncedAt: string | null;
  interactionsAvailable: boolean;
  interactions: number;
  interactionRate: number;
};

export type FacebookInsightsSummary = {
  configured: boolean;
  postsAnalyzed: number;
  interactionSamples: number;
  totalMediaViews: number;
  totalUniqueViewers: number;
  totalInteractions: number;
  totalClicks: number;
  totalReactions: number;
  totalComments: number;
  totalShares: number;
  totalVideoViews: number;
  /** Interactions per unique viewer, calculated only from complete social-interaction samples. */
  averageInteractionRate: number;
  topPillars: FacebookPillarPerformance[];
  topSlots: FacebookSlotPerformance[];
  recommendedSlot: string | null;
  topPerformers: FacebookPostPerformance[];
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type FacebookInsightsPostInput = FacebookPostMetrics & {
  facebookPostId: string;
  title: string;
  pillar: Pillar | null;
  slotLabel: string | null;
  publishedAt: string | null;
  syncedAt: string | null;
  interactionsAvailable: boolean;
};

const EMPTY_METRICS: FacebookPostMetrics = {
  mediaViews: 0,
  uniqueViewers: 0,
  clicks: 0,
  reactions: 0,
  comments: 0,
  shares: 0,
  videoViews: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, value) : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
  }
  return null;
}

function sumNumeric(value: unknown): number {
  const direct = numeric(value);
  if (direct !== null) return direct;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + sumNumeric(item), 0);
  const record = asRecord(value);
  if (!record) return 0;
  if (Object.hasOwn(record, "value")) return sumNumeric(record.value);
  return Object.values(record).reduce<number>((sum, item) => sum + sumNumeric(item), 0);
}

/** Parse normalized Meta Graph API `/{post-id}/insights` metrics (v25+ names). */
export function parseFacebookPostInsights(payload: unknown): FacebookPostMetrics {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const values = new Map<string, number>();
  for (const row of rows) {
    const metric = asRecord(row);
    if (typeof metric?.name !== "string") continue;
    const points = Array.isArray(metric.values) ? metric.values : [];
    values.set(metric.name, points.reduce((sum, point) => {
      const pointRecord = asRecord(point);
      return sum + sumNumeric(pointRecord?.value);
    }, 0));
  }
  return {
    mediaViews: Math.round(values.get("post_media_view") ?? 0),
    uniqueViewers: Math.round(values.get("post_total_media_view_unique") ?? 0),
    clicks: Math.round(values.get("post_clicks") ?? 0),
    reactions: Math.round(values.get("post_reactions_by_type_total") ?? 0),
    comments: 0,
    shares: 0,
    videoViews: Math.round(values.get("post_video_views") ?? 0),
  };
}

/** Parse a Post object expansion; comments and shares are intentionally separate from clicks. */
export function parseFacebookPostSocialStats(payload: unknown): { comments: number; shares: number } | null {
  const root = asRecord(payload);
  const comments = asRecord(root?.comments);
  const summary = asRecord(comments?.summary);
  const commentCount = numeric(summary?.total_count);
  if (commentCount === null) return null;
  const shares = asRecord(root?.shares);
  // Graph may omit the `shares` object when the total is zero.
  const shareCount = numeric(shares?.count) ?? 0;
  return { comments: Math.round(commentCount), shares: Math.round(shareCount) };
}

function interactionCount(post: FacebookInsightsPostInput): number {
  return post.interactionsAvailable ? post.reactions + post.comments + post.shares : 0;
}

function rate(interactions: number, uniqueViewers: number): number {
  return uniqueViewers > 0 ? Math.round((interactions / uniqueViewers) * 1_000) / 10 : 0;
}

type Aggregate = {
  posts: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
};

function addToGroup(group: Map<string, Aggregate>, key: string | null, post: FacebookInsightsPostInput): void {
  if (!key || !post.interactionsAvailable) return;
  const current = group.get(key) ?? { posts: 0, mediaViews: 0, uniqueViewers: 0, interactions: 0 };
  current.posts += 1;
  current.mediaViews += post.mediaViews;
  current.uniqueViewers += post.uniqueViewers;
  current.interactions += interactionCount(post);
  group.set(key, current);
}

/** Build honest aggregate performance without double-counting repeated article rows for one FB post. */
export function summarizeFacebookInsights(
  posts: readonly FacebookInsightsPostInput[],
  options: { configured: boolean; lastSyncedAt?: string | null; lastError?: string | null },
): FacebookInsightsSummary {
  const byPost = new Map<string, FacebookInsightsPostInput>();
  for (const post of posts) {
    if (!post.facebookPostId) continue;
    const existing = byPost.get(post.facebookPostId);
    if (!existing || (post.syncedAt ?? "") > (existing.syncedAt ?? "")) byPost.set(post.facebookPostId, post);
  }
  const uniquePosts = [...byPost.values()];
  const totals = uniquePosts.reduce((sum, post) => ({
    mediaViews: sum.mediaViews + post.mediaViews,
    uniqueViewers: sum.uniqueViewers + post.uniqueViewers,
    clicks: sum.clicks + post.clicks,
    reactions: sum.reactions + post.reactions,
    comments: sum.comments + (post.interactionsAvailable ? post.comments : 0),
    shares: sum.shares + (post.interactionsAvailable ? post.shares : 0),
    videoViews: sum.videoViews + post.videoViews,
  }), { ...EMPTY_METRICS, comments: 0, shares: 0 });
  const completePosts = uniquePosts.filter((post) => post.interactionsAvailable);
  const totalInteractions = completePosts.reduce((sum, post) => sum + interactionCount(post), 0);
  const interactionViewers = completePosts.reduce((sum, post) => sum + post.uniqueViewers, 0);

  const pillarGroups = new Map<string, Aggregate>();
  const slotGroups = new Map<string, Aggregate>();
  for (const post of uniquePosts) {
    addToGroup(pillarGroups, post.pillar, post);
    addToGroup(slotGroups, post.slotLabel, post);
  }
  const topPillars = [...pillarGroups.entries()]
    .map(([pillar, row]) => ({ ...row, pillar: pillar as Pillar, interactionRate: rate(row.interactions, row.uniqueViewers) }))
    .sort((left, right) => (right.interactionRate - left.interactionRate) || (right.interactions - left.interactions))
    .slice(0, 6);
  const topSlots = [...slotGroups.entries()]
    .map(([slotLabel, row]) => ({ ...row, slotLabel, interactionRate: rate(row.interactions, row.uniqueViewers) }))
    .sort((left, right) => (right.interactionRate - left.interactionRate) || (right.interactions - left.interactions));
  const eligibleRecommendation = topSlots
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot.slotLabel) && slot.posts >= 3)
    .sort((left, right) => (right.interactionRate - left.interactionRate) || (right.posts - left.posts))[0];
  const topPerformers = [...completePosts]
    .map((post) => ({ ...post, interactions: interactionCount(post), interactionRate: rate(interactionCount(post), post.uniqueViewers) }))
    .sort((left, right) => (right.interactions - left.interactions) || (right.uniqueViewers - left.uniqueViewers))
    .slice(0, 5);
  const syncedDates = uniquePosts.map((post) => post.syncedAt).filter((value): value is string => Boolean(value)).sort();

  return {
    configured: options.configured,
    postsAnalyzed: uniquePosts.length,
    interactionSamples: completePosts.length,
    totalMediaViews: totals.mediaViews,
    totalUniqueViewers: totals.uniqueViewers,
    totalInteractions,
    totalClicks: totals.clicks,
    totalReactions: totals.reactions,
    totalComments: totals.comments,
    totalShares: totals.shares,
    totalVideoViews: totals.videoViews,
    averageInteractionRate: rate(totalInteractions, interactionViewers),
    topPillars,
    topSlots,
    recommendedSlot: eligibleRecommendation?.slotLabel ?? null,
    topPerformers,
    lastSyncedAt: options.lastSyncedAt ?? syncedDates.at(-1) ?? null,
    lastError: options.lastError ?? null,
  };
}

export function buildFacebookInsightsSummary(
  posts: readonly FacebookInsightsPostInput[],
  options: { configured: boolean; lastSyncedAt?: string | null; lastError?: string | null },
): FacebookInsightsSummary {
  return summarizeFacebookInsights(posts, options);
}
