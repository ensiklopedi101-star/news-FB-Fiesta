import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, facebookInsightsSyncState, facebookPostInsights } from "@/lib/schema";
import {
  parseFacebookPostInsights,
  parseFacebookPostSocialStats,
  type FacebookPostMetrics,
} from "@/lib/facebook-insights-core";

const INSIGHTS_WINDOW_DAYS = 30;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 15 * 60 * 1000;
const SYNC_LOCK_MS = 5 * 60 * 1000;
const GRAPH_TIMEOUT_MS = 4_500;
const DEFAULT_SYNC_LIMIT = 24;
const SYNC_CONCURRENCY = 6;

// Meta deprecated post_impressions and post_impressions_unique; v25+ uses media views.
// Older/unavailable optional metrics are retried as narrower requests because one bad
// metric makes Graph reject the whole batch.
const metricSets = [
  ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total", "post_video_views"],
  ["post_media_view", "post_total_media_view_unique", "post_clicks", "post_reactions_by_type_total"],
  ["post_media_view", "post_total_media_view_unique", "post_reactions_by_type_total"],
  ["post_total_media_view_unique", "post_reactions_by_type_total"],
  ["post_total_media_view_unique"],
] as const;

export type FacebookInsightsSyncResult = {
  status: "synced" | "up-to-date" | "cooldown" | "busy" | "unconfigured" | "failed";
  configured: boolean;
  eligiblePosts: number;
  attemptedPosts: number;
  syncedPosts: number;
  partialPosts: number;
  failedPosts: number;
  lastSyncedAt: string | null;
  error?: string;
};

export type FacebookInsightsReadiness = {
  configured: boolean;
  missing: string[];
};

export function getFacebookInsightsReadiness(): FacebookInsightsReadiness {
  const missing: string[] = [];
  if (!process.env.FB_ENTERTAINMENT_PAGE_ID?.trim()) missing.push("FB_ENTERTAINMENT_PAGE_ID");
  if (!process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN?.trim()) missing.push("FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN");
  return { configured: missing.length === 0, missing };
}

let ensureTablesPromise: Promise<boolean> | null = null;

/** Idempotent bootstrap so a restricted DB degrades to the existing shortlink analytics. */
export async function ensureFacebookInsightsTables(): Promise<boolean> {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      const db = getDb();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "facebook_post_insights" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "page_id" text NOT NULL,
          "facebook_post_id" text NOT NULL,
          "media_views" integer DEFAULT 0 NOT NULL,
          "unique_viewers" integer DEFAULT 0 NOT NULL,
          "clicks" integer DEFAULT 0 NOT NULL,
          "reactions" integer DEFAULT 0 NOT NULL,
          "comments" integer DEFAULT 0 NOT NULL,
          "shares" integer DEFAULT 0 NOT NULL,
          "video_views" integer DEFAULT 0 NOT NULL,
          "interactions_available" boolean DEFAULT false NOT NULL,
          "synced_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "facebook_post_insights_page_post_unique"
        ON "facebook_post_insights" ("page_id", "facebook_post_id")
      `);
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "facebook_post_insights_synced_idx"
        ON "facebook_post_insights" ("synced_at")
      `);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "facebook_insights_sync_state" (
          "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
          "locked_until" timestamp with time zone DEFAULT 'epoch' NOT NULL,
          "last_attempt_at" timestamp with time zone,
          "last_success_at" timestamp with time zone,
          "last_error" text,
          "posts_synced" integer DEFAULT 0 NOT NULL,
          "posts_failed" integer DEFAULT 0 NOT NULL,
          "updated_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      return true;
    })().catch((error) => {
      ensureTablesPromise = null;
      console.warn("[facebook-insights] ensure tables failed:", error instanceof Error ? error.message : error);
      return false;
    });
  }
  return ensureTablesPromise;
}

export async function getFacebookInsightsSyncState() {
  try {
    if (!await ensureFacebookInsightsTables()) return null;
    const [state] = await getDb()
      .select()
      .from(facebookInsightsSyncState)
      .where(eq(facebookInsightsSyncState.id, 1))
      .limit(1);
    return state ?? null;
  } catch {
    return null;
  }
}

function graphVersion(): string {
  const configured = process.env.FB_INSIGHTS_GRAPH_VERSION?.trim() || "v25.0";
  const match = /^v(\d+)\.\d+$/.exec(configured);
  if (!match || Number(match[1]) < 25) {
    throw new Error("FB_INSIGHTS_GRAPH_VERSION harus v25.0 atau lebih baru agar metrik media-view tersedia.");
  }
  return configured;
}

function safeError(error: unknown, token: string): string {
  const detail = error instanceof Error ? error.message : String(error ?? "Kesalahan tidak diketahui.");
  return detail.split(token).join("[REDACTED]").replace(/\s+/g, " ").slice(0, 360);
}

function graphError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const error = (payload as { error?: { message?: string } }).error;
  return error?.message || null;
}

function payloadHasMetric(payload: unknown, metricName: string): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const data = (payload as { data?: unknown }).data;
  return Array.isArray(data) && data.some((row) => Boolean(
    row && typeof row === "object" && !Array.isArray(row)
    && (row as { name?: unknown }).name === metricName,
  ));
}

async function graphGet(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as unknown;
  const detail = graphError(payload);
  if (!response.ok || detail) {
    throw new Error(`Graph API ${response.status}: ${detail || response.statusText || "respons tidak valid"}`);
  }
  return payload;
}

async function fetchPostInsightsMetrics(
  postId: string,
  token: string,
  version: string,
): Promise<{ metrics: FacebookPostMetrics; reactionsAvailable: boolean }> {
  let lastError = "Meta Graph API tidak mengembalikan metrik post.";
  for (const metrics of metricSets) {
    const query = new URLSearchParams({ metric: metrics.join(","), period: "lifetime" });
    const url = `https://graph.facebook.com/${version}/${encodeURIComponent(postId)}/insights?${query.toString()}`;
    try {
      const payload = await graphGet(url, token) as { data?: unknown } | null;
      if (!Array.isArray(payload?.data) || payload.data.length === 0) {
        throw new Error("Meta mengembalikan dataset insight kosong; cek pages_read_engagement, read_insights, tugas Analyze, dan syarat Page minimal 100 suka.");
      }
      if (!payloadHasMetric(payload, "post_total_media_view_unique")) {
        throw new Error("Meta tidak mengembalikan metrik unique media viewers yang dibutuhkan untuk perbandingan post.");
      }
      return {
        metrics: parseFacebookPostInsights(payload),
        reactionsAvailable: payloadHasMetric(payload, "post_reactions_by_type_total"),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      // An invalid/unsupported metric rejects the full set. Try a smaller supported subset.
      if (!/Graph API 400|Graph API 422/.test(lastError)) break;
    }
  }
  throw new Error(lastError);
}

async function fetchPostSocialStats(
  postId: string,
  token: string,
  version: string,
): Promise<{ comments: number; shares: number }> {
  const query = new URLSearchParams({ fields: "comments.limit(0).summary(true),shares" });
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(postId)}?${query.toString()}`;
  const stats = parseFacebookPostSocialStats(await graphGet(url, token));
  if (!stats) throw new Error("Meta tidak mengembalikan ringkasan komentar post.");
  return stats;
}

async function collectOnePost(postId: string, token: string, version: string): Promise<{
  metrics: FacebookPostMetrics;
  interactionsAvailable: boolean;
  partialError: string | null;
}> {
  const insightResult = await fetchPostInsightsMetrics(postId, token, version);
  try {
    const socialStats = await fetchPostSocialStats(postId, token, version);
    return {
      metrics: { ...insightResult.metrics, ...socialStats },
      interactionsAvailable: insightResult.reactionsAvailable,
      partialError: insightResult.reactionsAvailable
        ? null
        : "Meta tidak mengembalikan metrik reaksi post.",
    };
  } catch (error) {
    return {
      metrics: insightResult.metrics,
      interactionsAvailable: false,
      partialError: error instanceof Error ? error.message : "Data komentar/bagikan tidak tersedia.",
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function isUsableFacebookPostId(value: string | null): value is string {
  const id = value?.trim();
  return Boolean(id && !id.startsWith("buffer:") && !id.includes(":pending:") && !id.startsWith("facebook:"));
}

async function loadRecentFacebookPosts() {
  const since = new Date(Date.now() - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({ facebookPostId: articles.facebookPostId, publishedAt: articles.publishedAt })
    .from(articles)
    .where(and(
      eq(articles.status, "published"),
      eq(articles.pageKey, "entertainment"),
      gte(articles.publishedAt, since),
      isNotNull(articles.facebookPostId),
    ))
    .orderBy(desc(articles.publishedAt))
    .limit(240);
  const unique = new Map<string, { facebookPostId: string; publishedAt: Date | null }>();
  for (const row of rows) {
    if (!isUsableFacebookPostId(row.facebookPostId)) continue;
    if (!unique.has(row.facebookPostId)) unique.set(row.facebookPostId, { facebookPostId: row.facebookPostId, publishedAt: row.publishedAt });
  }
  return [...unique.values()];
}

async function releaseSyncLock(input: {
  lastSuccessAt?: Date;
  lastError: string | null;
  postsSynced: number;
  postsFailed: number;
}): Promise<void> {
  await getDb().update(facebookInsightsSyncState).set({
    lockedUntil: new Date(0),
    ...(input.lastSuccessAt ? { lastSuccessAt: input.lastSuccessAt } : {}),
    lastError: input.lastError,
    postsSynced: input.postsSynced,
    postsFailed: input.postsFailed,
    updatedAt: new Date(),
  }).where(eq(facebookInsightsSyncState.id, 1)).catch(() => undefined);
}

/**
 * Pull read-only lifetime insights for recent direct Facebook publications.
 * Buffer post IDs and pending claims are excluded. Collection has an independent
 * Neon lease and never updates an article or changes the publishing cadence.
 */
export async function syncFacebookPostInsights(options?: {
  force?: boolean;
  maxPosts?: number;
}): Promise<FacebookInsightsSyncResult> {
  const readiness = getFacebookInsightsReadiness();
  if (!readiness.configured) {
    return {
      status: "unconfigured",
      configured: false,
      eligiblePosts: 0,
      attemptedPosts: 0,
      syncedPosts: 0,
      partialPosts: 0,
      failedPosts: 0,
      lastSyncedAt: null,
      error: `Atur ${readiness.missing.join(" dan ")} di Vercel untuk membaca Facebook Insights.`,
    };
  }
  if (!await ensureFacebookInsightsTables()) {
    return {
      status: "failed",
      configured: true,
      eligiblePosts: 0,
      attemptedPosts: 0,
      syncedPosts: 0,
      partialPosts: 0,
      failedPosts: 0,
      lastSyncedAt: null,
      error: "Tabel Facebook Insights belum siap; jalankan drizzle/0018_facebook_insights.sql atau periksa izin database.",
    };
  }

  const pageId = process.env.FB_ENTERTAINMENT_PAGE_ID!.trim();
  const token = process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN!.trim();
  const now = new Date();
  let lockAcquired = false;
  let eligiblePosts = 0;
  try {
    const version = graphVersion();
    const posts = await loadRecentFacebookPosts();
    eligiblePosts = posts.length;
    if (!posts.length) {
      const state = await getFacebookInsightsSyncState();
      return {
        status: "up-to-date",
        configured: true,
        eligiblePosts: 0,
        attemptedPosts: 0,
        syncedPosts: 0,
        partialPosts: 0,
        failedPosts: 0,
        lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? null,
      };
    }

    const postIds = posts.map((post) => post.facebookPostId);
    const db = getDb();
    const [state] = await db.select().from(facebookInsightsSyncState).where(eq(facebookInsightsSyncState.id, 1)).limit(1);
    if (!options?.force && state?.lastAttemptAt && now.getTime() - state.lastAttemptAt.getTime() < RETRY_COOLDOWN_MS) {
      return {
        status: "cooldown",
        configured: true,
        eligiblePosts: posts.length,
        attemptedPosts: 0,
        syncedPosts: 0,
        partialPosts: 0,
        failedPosts: 0,
        lastSyncedAt: state.lastSuccessAt?.toISOString() ?? null,
        ...(state.lastError ? { error: state.lastError } : {}),
      };
    }

    const existingRows = await db.select().from(facebookPostInsights)
      .where(and(eq(facebookPostInsights.pageId, pageId), inArray(facebookPostInsights.facebookPostId, postIds)));
    const latestByPostId = new Map(existingRows.map((row) => [row.facebookPostId, row]));
    const refreshBefore = now.getTime() - REFRESH_INTERVAL_MS;
    const maxPosts = Math.max(1, Math.min(options?.maxPosts ?? DEFAULT_SYNC_LIMIT, 60));
    let pending = posts.filter((post) => {
      const cached = latestByPostId.get(post.facebookPostId);
      return options?.force || !cached || cached.syncedAt.getTime() < refreshBefore;
    }).slice(0, maxPosts);
    if (!pending.length) {
      return {
        status: "up-to-date",
        configured: true,
        eligiblePosts: posts.length,
        attemptedPosts: 0,
        syncedPosts: 0,
        partialPosts: 0,
        failedPosts: 0,
        lastSyncedAt: state?.lastSuccessAt?.toISOString() ?? existingRows
          .map((row) => row.syncedAt)
          .sort((left, right) => right.getTime() - left.getTime())[0]?.toISOString() ?? null,
        ...(state?.lastError ? { error: state.lastError } : {}),
      };
    }

    const lockedUntil = new Date(now.getTime() + SYNC_LOCK_MS);
    const acquired = await db.insert(facebookInsightsSyncState).values({
      id: 1,
      lockedUntil,
      lastAttemptAt: now,
      lastError: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: facebookInsightsSyncState.id,
      set: {
        lockedUntil,
        lastAttemptAt: now,
        lastError: null,
        updatedAt: now,
      },
      where: lt(facebookInsightsSyncState.lockedUntil, now),
    }).returning({ id: facebookInsightsSyncState.id });
    if (!acquired.length) {
      const current = await getFacebookInsightsSyncState();
      return {
        status: "busy",
        configured: true,
        eligiblePosts: posts.length,
        attemptedPosts: 0,
        syncedPosts: 0,
        partialPosts: 0,
        failedPosts: 0,
        lastSyncedAt: current?.lastSuccessAt?.toISOString() ?? null,
      };
    }
    lockAcquired = true;

    // Recheck after taking the DB lease so concurrent cron invocations do not fetch the same batch.
    const refreshedRows = await db.select().from(facebookPostInsights)
      .where(and(eq(facebookPostInsights.pageId, pageId), inArray(facebookPostInsights.facebookPostId, postIds)));
    const refreshedByPostId = new Map(refreshedRows.map((row) => [row.facebookPostId, row]));
    pending = posts.filter((post) => {
      const cached = refreshedByPostId.get(post.facebookPostId);
      return options?.force || !cached || cached.syncedAt.getTime() < refreshBefore;
    }).slice(0, maxPosts);
    if (!pending.length) {
      await releaseSyncLock({ lastError: null, postsSynced: 0, postsFailed: 0 });
      lockAcquired = false;
      const current = await getFacebookInsightsSyncState();
      return {
        status: "up-to-date",
        configured: true,
        eligiblePosts: posts.length,
        attemptedPosts: 0,
        syncedPosts: 0,
        partialPosts: 0,
        failedPosts: 0,
        lastSyncedAt: current?.lastSuccessAt?.toISOString() ?? null,
      };
    }

    const results = await mapWithConcurrency(pending, SYNC_CONCURRENCY, async (post) => {
      try {
        const collected = await collectOnePost(post.facebookPostId, token, version);
        await db.insert(facebookPostInsights).values({
          pageId,
          facebookPostId: post.facebookPostId,
          mediaViews: collected.metrics.mediaViews,
          uniqueViewers: collected.metrics.uniqueViewers,
          clicks: collected.metrics.clicks,
          reactions: collected.metrics.reactions,
          comments: collected.metrics.comments,
          shares: collected.metrics.shares,
          videoViews: collected.metrics.videoViews,
          interactionsAvailable: collected.interactionsAvailable,
          syncedAt: new Date(),
        }).onConflictDoUpdate({
          target: [facebookPostInsights.pageId, facebookPostInsights.facebookPostId],
          set: {
            mediaViews: collected.metrics.mediaViews,
            uniqueViewers: collected.metrics.uniqueViewers,
            clicks: collected.metrics.clicks,
            reactions: collected.metrics.reactions,
            comments: collected.metrics.comments,
            shares: collected.metrics.shares,
            videoViews: collected.metrics.videoViews,
            interactionsAvailable: collected.interactionsAvailable,
            syncedAt: new Date(),
          },
        });
        return { ok: true as const, partialError: collected.partialError };
      } catch (error) {
        return { ok: false as const, error: safeError(error, token) };
      }
    });
    const syncedPosts = results.filter((result) => result.ok).length;
    const partialPosts = results.filter((result) => result.ok && Boolean(result.partialError)).length;
    const failed = results.filter((result): result is { ok: false; error: string } => !result.ok);
    const firstPartialError = results.find((result) => result.ok && result.partialError)?.partialError ?? null;
    const current = new Date();
    const errorText = failed[0]?.error ?? (firstPartialError
      ? `${partialPosts} post disinkronkan tanpa ringkasan komentar/bagikan: ${safeError(firstPartialError, token)}`
      : null);
    await releaseSyncLock({
      ...(syncedPosts > 0 ? { lastSuccessAt: current } : {}),
      lastError: errorText,
      postsSynced: syncedPosts,
      postsFailed: failed.length,
    });
    lockAcquired = false;

    return {
      status: failed.length > 0 && syncedPosts === 0 ? "failed" : "synced",
      configured: true,
      eligiblePosts: posts.length,
      attemptedPosts: pending.length,
      syncedPosts,
      partialPosts,
      failedPosts: failed.length,
      lastSyncedAt: syncedPosts > 0 ? current.toISOString() : state?.lastSuccessAt?.toISOString() ?? null,
      ...(errorText ? { error: errorText } : {}),
    };
  } catch (error) {
    const message = safeError(error, token);
    if (lockAcquired) {
      await releaseSyncLock({ lastError: message, postsSynced: 0, postsFailed: 0 });
    }
    console.error("[facebook-insights] sync failed:", message);
    const current = await getFacebookInsightsSyncState();
    return {
      status: "failed",
      configured: true,
      eligiblePosts,
      attemptedPosts: 0,
      syncedPosts: 0,
      partialPosts: 0,
      failedPosts: 0,
      lastSyncedAt: current?.lastSuccessAt?.toISOString() ?? null,
      error: message,
    };
  }
}
