import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, automationLogs, publisherState, quizEditions, reels, rssSources } from "@/lib/schema";
import { shortlinkOnlyHost } from "@/lib/host-routing";
import { selectedRoundupImage } from "@/lib/roundup";
import { slotStateAt } from "@/lib/publish-slots";
import { publishPolicy } from "@/lib/schedule";
import {
  assessAutomationHealth,
  type AutomationHealthReport,
  type AutomationOutcome,
  type AutomationSource,
  type AutomationTrigger,
} from "@/lib/automation-health";

let ensureTablePromise: Promise<boolean> | null = null;

function configuredSecretValues(): string[] {
  return [
    process.env.CRON_SECRET,
    process.env.DATABASE_URL,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_FALLBACK,
    process.env.GROQ_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.BUFFER_API_KEY,
    process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN,
    process.env.IG_ACCESS_TOKEN,
    process.env.BLOB_READ_WRITE_TOKEN,
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length >= 6);
}

export function redactDiagnosticText(value: string): string {
  let result = value;
  for (const secret of configuredSecretValues()) {
    result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, "$1[REDACTED]@");
}

function sanitizeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const serialized = redactDiagnosticText(JSON.stringify(detail));
    return JSON.parse(serialized.slice(0, 12_000)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function ensureAutomationLogsTable(): Promise<boolean> {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      const db = getDb();
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "automation_logs" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "source" text NOT NULL,
          "trigger" text NOT NULL DEFAULT 'scheduled',
          "outcome" text NOT NULL,
          "summary" text NOT NULL,
          "detail" jsonb,
          "created_at" timestamp with time zone DEFAULT now() NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_logs_created_idx" ON "automation_logs" ("created_at" DESC)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "automation_logs_source_created_idx" ON "automation_logs" ("source", "created_at" DESC)`);
      return true;
    })().catch((error) => {
      ensureTablePromise = null;
      console.warn("[automation-log] ensure table failed:", error instanceof Error ? error.message : error);
      return false;
    });
  }
  return ensureTablePromise;
}

export async function recordAutomationEvent(input: {
  source: AutomationSource;
  trigger?: AutomationTrigger;
  outcome: AutomationOutcome;
  summary: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    const ready = await ensureAutomationLogsTable();
    if (!ready) return;
    const db = getDb();
    const summary = redactDiagnosticText(input.summary).slice(0, 600);
    const detail = sanitizeDetail(input.detail);
    await db.insert(automationLogs).values({
      source: input.source,
      trigger: input.trigger ?? "scheduled",
      outcome: input.outcome,
      summary,
      detail,
    });
    // Keep only the latest 5 outside-slot heartbeats so real runs and errors stay visible.
    if (input.outcome === "outside-slot") {
      await db.execute(sql`
        DELETE FROM "automation_logs"
        WHERE "outcome" = 'outside-slot'
          AND "id" NOT IN (
            SELECT "id" FROM "automation_logs"
            WHERE "outcome" = 'outside-slot'
            ORDER BY "created_at" DESC
            LIMIT 5
          )
      `).catch(() => undefined);
    }
    const retentionCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db.delete(automationLogs).where(lt(automationLogs.createdAt, retentionCutoff)).catch(() => undefined);
  } catch (error) {
    console.warn("[automation-log] write failed:", error instanceof Error ? error.message : error);
  }
}

export type DiagnosticsSnapshot = {
  checkedAt: string;
  health: AutomationHealthReport;
  heartbeats: {
    lastCronAt: string | null;
    lastCronOutcome: string | null;
    lastCronSummary: string | null;
    lastHarvestAt: string | null;
    lastHarvestOutcome: string | null;
    lastHarvestSummary: string | null;
    lastFeedFetchedAt: string | null;
    lastPublishedAt: string | null;
    lastPublishedTitle: string | null;
  };
  queue: {
    queuedTotal: number;
    queuedEntertainment: number;
    imageEligibleEntertainment: number;
    queuedNews: number;
    processingCount: number;
    expiredLast24h: number;
    failedLast24h: number;
    publisherLockedUntil: string | null;
  };
  cronSetup: {
    appUrl: string | null;
    appUrlHost: string | null;
    shortlinkOnlyHost: string | null;
    harvestEndpoint: string;
    cronEndpoint: string;
  };
  failingFeeds: Array<{
    id: string;
    name: string;
    pageKey: "news" | "entertainment";
    feedUrl: string;
    lastFetchedAt: string | null;
    lastError: string;
  }>;
  failedArticles: Array<{
    id: string;
    title: string;
    sourceName: string;
    pageKey: "news" | "entertainment";
    errorMessage: string;
    attempts: number;
    updatedAt: string;
  }>;
  subsystemErrors: Array<{
    subsystem: "quiz" | "reels" | "instagram-comment";
    title: string;
    errorMessage: string;
    occurredAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    source: string;
    trigger: string;
    outcome: string;
    summary: string;
    detail: Record<string, unknown> | null;
    createdAt: string;
  }>;
  schedule: ReturnType<typeof publishPolicy>;
  publishSchedule: ReturnType<typeof slotStateAt>;
};

export async function getDiagnosticsSnapshot(eventLimit = 25): Promise<DiagnosticsSnapshot> {
  const db = getDb();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  await ensureAutomationLogsTable();

  const [
    feeds,
    queuedRows,
    processingCountRows,
    expiredCountRows,
    failedCountRows,
    failedArticleRows,
    publishedWarningRows,
    lastPublishedRows,
    lockRows,
  ] = await Promise.all([
    db.select().from(rssSources).orderBy(asc(rssSources.pageKey), asc(rssSources.name)),
    db.select({
      id: articles.id,
      pageKey: articles.pageKey,
      imageUrl: articles.imageUrl,
      imageUrls: articles.imageUrls,
      manualImageUrls: articles.manualImageUrls,
    }).from(articles).where(eq(articles.status, "queued")),
    db.select({ value: count() }).from(articles).where(eq(articles.status, "processing")),
    db.select({ value: count() }).from(articles).where(and(eq(articles.status, "expired"), gte(articles.updatedAt, since24h))),
    db.select({ value: count() }).from(articles).where(and(eq(articles.status, "failed"), gte(articles.updatedAt, since24h))),
    db.select({
      id: articles.id,
      title: articles.title,
      sourceName: articles.sourceName,
      pageKey: articles.pageKey,
      errorMessage: articles.errorMessage,
      attempts: articles.attempts,
      updatedAt: articles.updatedAt,
    }).from(articles)
      .where(eq(articles.status, "failed"))
      .orderBy(desc(articles.updatedAt))
      .limit(10),
    db.select({
      title: articles.title,
      errorMessage: articles.errorMessage,
      updatedAt: articles.updatedAt,
    }).from(articles)
      .where(and(eq(articles.status, "published"), isNotNull(articles.errorMessage)))
      .orderBy(desc(articles.updatedAt))
      .limit(5),
    db.select({
      title: articles.title,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
    }).from(articles)
      .where(eq(articles.status, "published"))
      .orderBy(desc(sql`coalesce(${articles.publishedAt}, ${articles.updatedAt})`))
      .limit(1),
    db.select({ lockedUntil: publisherState.lockedUntil }).from(publisherState).where(eq(publisherState.id, 1)).limit(1).catch(() => []),
  ]);

  const recentEventsRaw = await db.select()
    .from(automationLogs)
    .orderBy(desc(automationLogs.createdAt))
    .limit(Math.max(10, Math.min(eventLimit, 80)))
    .catch(() => []);

  const [lastCronEvent] = await db.select()
    .from(automationLogs)
    .where(eq(automationLogs.source, "cron"))
    .orderBy(desc(automationLogs.createdAt))
    .limit(1)
    .catch(() => []);

  const [lastHarvestEvent] = await db.select()
    .from(automationLogs)
    .where(inArray(automationLogs.source, ["harvest", "cron-auto-harvest"]))
    .orderBy(desc(automationLogs.createdAt))
    .limit(1)
    .catch(() => []);

  const subsystemErrors: DiagnosticsSnapshot["subsystemErrors"] = [];
  for (const row of publishedWarningRows) {
    if (row.errorMessage) {
      subsystemErrors.push({
        subsystem: "instagram-comment",
        title: row.title,
        errorMessage: redactDiagnosticText(row.errorMessage),
        occurredAt: row.updatedAt.toISOString(),
      });
    }
  }
  const [quizErr] = await db.select({ errorMessage: quizEditions.errorMessage, updatedAt: quizEditions.updatedAt })
    .from(quizEditions)
    .where(isNotNull(quizEditions.errorMessage))
    .orderBy(desc(quizEditions.updatedAt))
    .limit(1)
    .catch(() => []);
  if (quizErr?.errorMessage) {
    subsystemErrors.push({
      subsystem: "quiz",
      title: "Kuis Tebak Drama",
      errorMessage: redactDiagnosticText(quizErr.errorMessage),
      occurredAt: quizErr.updatedAt.toISOString(),
    });
  }
  const [reelErr] = await db.select({ errorMessage: reels.errorMessage, updatedAt: reels.updatedAt })
    .from(reels)
    .where(isNotNull(reels.errorMessage))
    .orderBy(desc(reels.updatedAt))
    .limit(1)
    .catch(() => []);
  if (reelErr?.errorMessage) {
    subsystemErrors.push({
      subsystem: "reels",
      title: "Render / Publikasi Reels",
      errorMessage: redactDiagnosticText(reelErr.errorMessage),
      occurredAt: reelErr.updatedAt.toISOString(),
    });
  }

  const activeFeeds = feeds.filter((feed) => feed.active);
  const failingFeeds = activeFeeds
    .filter((feed): feed is typeof feed & { lastError: string } => Boolean(feed.lastError?.trim()))
    .map((feed) => ({
      id: feed.id,
      name: feed.name,
      pageKey: feed.pageKey,
      feedUrl: feed.feedUrl,
      lastFetchedAt: feed.lastFetchedAt?.toISOString() ?? null,
      lastError: redactDiagnosticText(feed.lastError),
    }));

  const lastFeedFetchedAt = activeFeeds.reduce<Date | null>((latest, feed) => {
    if (!feed.lastFetchedAt) return latest;
    return !latest || feed.lastFetchedAt > latest ? feed.lastFetchedAt : latest;
  }, null);

  const entertainmentQueued = queuedRows.filter((row) => row.pageKey === "entertainment");
  const imageEligibleEntertainment = entertainmentQueued.filter((row) => Boolean(selectedRoundupImage(row))).length;
  const queuedNews = queuedRows.filter((row) => row.pageKey === "news").length;
  const lastPublishedRow = lastPublishedRows[0] ?? null;
  const lastPublishedAt = lastPublishedRow ? (lastPublishedRow.publishedAt ?? lastPublishedRow.updatedAt) : null;
  const publisherLockedUntil = lockRows[0]?.lockedUntil ?? null;

  let appUrl: string | null = null;
  let appUrlHost: string | null = null;
  if (process.env.APP_URL?.trim()) {
    try {
      const parsed = new URL(process.env.APP_URL.trim());
      appUrl = parsed.toString().replace(/\/$/, "");
      appUrlHost = parsed.host;
    } catch {
      appUrl = process.env.APP_URL.trim();
    }
  }
  const configuredShortHost = shortlinkOnlyHost();
  const baseForCron = appUrl && appUrlHost?.toLowerCase() !== configuredShortHost?.toLowerCase()
    ? appUrl
    : "https://portal-beez.vercel.app";

  // Read-only Insights failures are shown in the event history but must not make
  // publishing/RSS health look broken; the dashboard exposes their own status.
  const recentAutomationErrors = recentEventsRaw.filter(
    (event) => event.outcome === "error" && event.createdAt >= since24h && event.source !== "facebook-insights",
  ).length;

  const health = assessAutomationHealth({
    now,
    activeFeedCount: activeFeeds.length,
    failingFeedCount: failingFeeds.length,
    lastFeedFetchedAt,
    lastCronAt: lastCronEvent?.createdAt ?? null,
    lastCronOutcome: lastCronEvent?.outcome ?? null,
    lastHarvestAt: lastHarvestEvent?.createdAt ?? null,
    lastPublishedAt,
    queuedTotal: queuedRows.length,
    queuedEntertainment: entertainmentQueued.length,
    imageEligibleEntertainment,
    failedArticlesLast24h: failedCountRows[0]?.value ?? 0,
    recentAutomationErrors,
    publisherLockedUntil,
    appUrlHost,
    shortlinkOnlyHost: configuredShortHost,
  });

  return {
    checkedAt: now.toISOString(),
    health,
    heartbeats: {
      lastCronAt: lastCronEvent?.createdAt.toISOString() ?? null,
      lastCronOutcome: lastCronEvent?.outcome ?? null,
      lastCronSummary: lastCronEvent?.summary ?? null,
      lastHarvestAt: lastHarvestEvent?.createdAt.toISOString() ?? null,
      lastHarvestOutcome: lastHarvestEvent?.outcome ?? null,
      lastHarvestSummary: lastHarvestEvent?.summary ?? null,
      lastFeedFetchedAt: lastFeedFetchedAt?.toISOString() ?? null,
      lastPublishedAt: lastPublishedAt?.toISOString() ?? null,
      lastPublishedTitle: lastPublishedRow?.title ?? null,
    },
    queue: {
      queuedTotal: queuedRows.length,
      queuedEntertainment: entertainmentQueued.length,
      imageEligibleEntertainment,
      queuedNews,
      processingCount: processingCountRows[0]?.value ?? 0,
      expiredLast24h: expiredCountRows[0]?.value ?? 0,
      failedLast24h: failedCountRows[0]?.value ?? 0,
      publisherLockedUntil: publisherLockedUntil && publisherLockedUntil.getTime() > 0 ? publisherLockedUntil.toISOString() : null,
    },
    cronSetup: {
      appUrl,
      appUrlHost,
      shortlinkOnlyHost: configuredShortHost,
      harvestEndpoint: `${baseForCron}/api/harvest`,
      cronEndpoint: `${baseForCron}/api/cron`,
    },
    failingFeeds,
    failedArticles: failedArticleRows.map((row) => ({
      id: row.id,
      title: row.title,
      sourceName: row.sourceName,
      pageKey: row.pageKey,
      errorMessage: redactDiagnosticText(row.errorMessage ?? "Tanpa pesan error."),
      attempts: row.attempts,
      updatedAt: row.updatedAt.toISOString(),
    })),
    subsystemErrors,
    recentEvents: recentEventsRaw.map((event) => ({
      id: event.id,
      source: event.source,
      trigger: event.trigger,
      outcome: event.outcome,
      summary: redactDiagnosticText(event.summary),
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
    })),
    schedule: publishPolicy(),
    publishSchedule: slotStateAt(now),
  };
}
