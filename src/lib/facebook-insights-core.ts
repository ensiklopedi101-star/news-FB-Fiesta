import type { Pillar } from "@/lib/pillars";

export const FACEBOOK_METRIC_NAMES = [
  "mediaViews",
  "uniqueViewers",
  "clicks",
  "reactions",
  "comments",
  "shares",
  "videoViews",
] as const;
export type FacebookMetricName = (typeof FACEBOOK_METRIC_NAMES)[number];

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
  /** Complete interaction samples that also have a unique-viewer metric. */
  rateSamples: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number | null;
};

export type FacebookSegmentPerformance = {
  segment: string;
  /** Complete interaction samples that also have a unique-viewer metric. */
  posts: number;
  rateSamples: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number | null;
};

export type FacebookFormatPerformance = {
  contentFormat: string;
  /** Complete interaction samples that also have a unique-viewer metric. */
  posts: number;
  rateSamples: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number | null;
};

export type FacebookSlotPerformance = {
  slotLabel: string;
  /** Posts with a complete reactions + comments + shares sample. */
  posts: number;
  /** Complete interaction samples that also have a unique-viewer metric. */
  rateSamples: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  interactionRate: number | null;
};

export type FacebookPostPerformance = FacebookPostMetrics & {
  facebookPostId: string;
  title: string;
  pillar: Pillar | null;
  segment: string | null;
  contentFormat: string | null;
  slotLabel: string | null;
  publishedAt: string | null;
  syncedAt: string | null;
  availableMetrics: FacebookMetricName[];
  interactionsAvailable: boolean;
  interactions: number;
  interactionRate: number | null;
};

export type FacebookInsightsSummary = {
  configured: boolean;
  postsAnalyzed: number;
  interactionSamples: number;
  interactionRateSamples: number;
  totalMediaViews: number;
  mediaViewSamples: number;
  totalUniqueViewers: number;
  uniqueViewerSamples: number;
  totalInteractions: number;
  totalClicks: number;
  clickSamples: number;
  totalReactions: number;
  reactionSamples: number;
  totalComments: number;
  commentSamples: number;
  totalShares: number;
  shareSamples: number;
  totalVideoViews: number;
  videoViewSamples: number;
  /** Null unless a complete interaction sample also includes unique viewers. */
  averageInteractionRate: number | null;
  topPillars: FacebookPillarPerformance[];
  topSegments: FacebookSegmentPerformance[];
  topFormats: FacebookFormatPerformance[];
  topSlots: FacebookSlotPerformance[];
  recommendedSlot: string | null;
  topPerformers: FacebookPostPerformance[];
  /** Revenue/payout data is deliberately not inferred from views or engagement. */
  monetization: { available: false; note: string };
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type FacebookInsightsPostInput = FacebookPostMetrics & {
  facebookPostId: string;
  title: string;
  pillar: Pillar | null;
  segment: string | null;
  contentFormat: string | null;
  slotLabel: string | null;
  publishedAt: string | null;
  syncedAt: string | null;
  availableMetrics: FacebookMetricName[];
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

const GRAPH_METRIC_TO_FIELD: Record<string, FacebookMetricName> = {
  post_media_view: "mediaViews",
  post_total_media_view_unique: "uniqueViewers",
  post_clicks: "clicks",
  post_reactions_by_type_total: "reactions",
  post_video_views: "videoViews",
};

export function normalizeAvailableMetrics(value: unknown): FacebookMetricName[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is FacebookMetricName =>
    typeof item === "string" && (FACEBOOK_METRIC_NAMES as readonly string[]).includes(item),
  ))];
}

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

function hasNumericValue(value: unknown): boolean {
  if (numeric(value) !== null) return true;
  if (Array.isArray(value)) return value.some(hasNumericValue);
  const record = asRecord(value);
  if (!record) return false;
  if (Object.hasOwn(record, "value")) return hasNumericValue(record.value);
  return Object.values(record).some(hasNumericValue);
}

/** Names of only those metrics Meta actually returned, including a legitimate zero. */
export function availableFacebookPostMetrics(payload: unknown): FacebookMetricName[] {
  const root = asRecord(payload);
  const rows = Array.isArray(root?.data) ? root.data : [];
  const available = new Set<FacebookMetricName>();
  for (const row of rows) {
    const metric = asRecord(row);
    if (typeof metric?.name !== "string") continue;
    const field = GRAPH_METRIC_TO_FIELD[metric.name];
    const points = Array.isArray(metric.values) ? metric.values : [];
    const hasValue = points.some((point) => {
      const pointRecord = asRecord(point);
      return Boolean(pointRecord && Object.hasOwn(pointRecord, "value") && hasNumericValue(pointRecord.value));
    });
    if (field && hasValue) available.add(field);
  }
  return FACEBOOK_METRIC_NAMES.filter((field) => available.has(field));
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

/** Parse whichever comment/share counters Graph returned; absent fields stay unavailable. */
export function parseFacebookPostSocialStats(payload: unknown): { comments: number | null; shares: number | null } | null {
  const root = asRecord(payload);
  const comments = asRecord(root?.comments);
  const summary = asRecord(comments?.summary);
  const commentCount = numeric(summary?.total_count);
  const sharesObject = asRecord(root?.shares);
  const parsedShareCount = numeric(sharesObject?.count);
  const shareCount = parsedShareCount;
  if (commentCount === null && shareCount === null) return null;
  return {
    comments: commentCount === null ? null : Math.round(commentCount),
    shares: shareCount === null ? null : Math.round(shareCount),
  };
}

function hasMetric(post: FacebookInsightsPostInput, key: FacebookMetricName): boolean {
  return post.availableMetrics.includes(key);
}

function interactionCount(post: FacebookInsightsPostInput): number {
  return post.interactionsAvailable ? post.reactions + post.comments + post.shares : 0;
}

function rate(interactions: number, uniqueViewers: number, available: boolean): number | null {
  return available && uniqueViewers > 0 ? Math.round((interactions / uniqueViewers) * 1_000) / 10 : null;
}

type Aggregate = {
  posts: number;
  mediaViews: number;
  uniqueViewers: number;
  interactions: number;
  rateSamples: number;
  rateInteractions: number;
};

function addToGroup(group: Map<string, Aggregate>, key: string | null, post: FacebookInsightsPostInput): void {
  if (!key || !post.interactionsAvailable) return;
  const current = group.get(key) ?? { posts: 0, mediaViews: 0, uniqueViewers: 0, interactions: 0, rateSamples: 0, rateInteractions: 0 };
  current.posts += 1;
  if (hasMetric(post, "mediaViews")) current.mediaViews += post.mediaViews;
  if (hasMetric(post, "uniqueViewers")) {
    current.uniqueViewers += post.uniqueViewers;
    current.rateSamples += 1;
    current.rateInteractions += interactionCount(post);
  }
  current.interactions += interactionCount(post);
  group.set(key, current);
}

function performanceRows(
  groups: Map<string, Aggregate>,
  key: "pillar" | "segment" | "contentFormat" | "slotLabel",
): Array<Record<string, unknown>> {
  return [...groups.entries()]
    .map(([value, row]) => ({
      [key]: value,
      posts: row.posts,
      rateSamples: row.rateSamples,
      mediaViews: row.mediaViews,
      uniqueViewers: row.uniqueViewers,
      interactions: row.interactions,
      interactionRate: rate(row.rateInteractions, row.uniqueViewers, row.rateSamples > 0),
    }))
    .sort((left, right) => {
      const leftRate = typeof left.interactionRate === "number" ? left.interactionRate : -1;
      const rightRate = typeof right.interactionRate === "number" ? right.interactionRate : -1;
      return (rightRate - leftRate) || (Number(right.interactions) - Number(left.interactions));
    }) as Array<Record<string, unknown>>;
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
  const uniquePosts = [...byPost.values()].filter((post) => post.availableMetrics.length > 0);
  const totals = { ...EMPTY_METRICS };
  const samples = {
    mediaViews: 0,
    uniqueViewers: 0,
    clicks: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    videoViews: 0,
  };
  for (const post of uniquePosts) {
    for (const metric of FACEBOOK_METRIC_NAMES) {
      if (!hasMetric(post, metric)) continue;
      totals[metric] += post[metric];
      samples[metric] += 1;
    }
  }

  const completePosts = uniquePosts.filter((post) => post.interactionsAvailable);
  const totalInteractions = completePosts.reduce((sum, post) => sum + interactionCount(post), 0);
  const ratePosts = completePosts.filter((post) => hasMetric(post, "uniqueViewers"));
  const interactionViewers = ratePosts.reduce((sum, post) => sum + post.uniqueViewers, 0);
  const rateInteractions = ratePosts.reduce((sum, post) => sum + interactionCount(post), 0);

  const pillarGroups = new Map<string, Aggregate>();
  const segmentGroups = new Map<string, Aggregate>();
  const formatGroups = new Map<string, Aggregate>();
  const slotGroups = new Map<string, Aggregate>();
  for (const post of uniquePosts) {
    addToGroup(pillarGroups, post.pillar, post);
    addToGroup(segmentGroups, post.segment, post);
    addToGroup(formatGroups, post.contentFormat, post);
    addToGroup(slotGroups, post.slotLabel, post);
  }
  const pillars = performanceRows(pillarGroups, "pillar") as unknown as FacebookPillarPerformance[];
  const segments = performanceRows(segmentGroups, "segment") as unknown as FacebookSegmentPerformance[];
  const formats = performanceRows(formatGroups, "contentFormat") as unknown as FacebookFormatPerformance[];
  const topSlots = performanceRows(slotGroups, "slotLabel") as unknown as FacebookSlotPerformance[];
  const eligibleRecommendation = topSlots
    .filter((slot) => /^\d{2}:\d{2}$/.test(slot.slotLabel) && slot.rateSamples >= 3 && slot.interactionRate !== null)
    .sort((left, right) => (right.interactionRate! - left.interactionRate!) || (right.posts - left.posts))[0];
  const topPerformers = [...completePosts]
    .map((post) => ({
      ...post,
      interactions: interactionCount(post),
      interactionRate: rate(interactionCount(post), post.uniqueViewers, hasMetric(post, "uniqueViewers")),
    }))
    .sort((left, right) => (right.interactions - left.interactions) || (right.uniqueViewers - left.uniqueViewers))
    .slice(0, 5);
  const syncedDates = uniquePosts.map((post) => post.syncedAt).filter((value): value is string => Boolean(value)).sort();

  return {
    configured: options.configured,
    postsAnalyzed: uniquePosts.length,
    interactionSamples: completePosts.length,
    interactionRateSamples: ratePosts.length,
    totalMediaViews: totals.mediaViews,
    mediaViewSamples: samples.mediaViews,
    totalUniqueViewers: totals.uniqueViewers,
    uniqueViewerSamples: samples.uniqueViewers,
    totalInteractions,
    totalClicks: totals.clicks,
    clickSamples: samples.clicks,
    totalReactions: totals.reactions,
    reactionSamples: samples.reactions,
    totalComments: totals.comments,
    commentSamples: samples.comments,
    totalShares: totals.shares,
    shareSamples: samples.shares,
    totalVideoViews: totals.videoViews,
    videoViewSamples: samples.videoViews,
    averageInteractionRate: rate(rateInteractions, interactionViewers, ratePosts.length > 0),
    topPillars: pillars,
    topSegments: segments,
    topFormats: formats,
    topSlots,
    recommendedSlot: eligibleRecommendation?.slotLabel ?? null,
    topPerformers,
    monetization: {
      available: false,
      note: "Integrasi saat ini tidak membaca payout atau pendapatan. Views dan interaksi tidak ditafsirkan sebagai penghasilan.",
    },
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
