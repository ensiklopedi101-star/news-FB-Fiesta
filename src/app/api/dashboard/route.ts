import { and, asc, count, desc, eq, gte, like } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { articles, publisherState, rssSources } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleStatus = "queued" | "processing" | "ready" | "published" | "failed";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Masukkan CRON_SECRET untuk membuka dashboard." }, { status: 401 });

  try {
    const db = getDb();
    await db.insert(publisherState).values({ id: 1 }).onConflictDoNothing();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [articleTotal] = await db.select({ value: count() }).from(articles);
    const [publishedToday] = await db.select({ value: count() }).from(articles)
      .where(and(eq(articles.status, "published"), gte(articles.publishedAt, today)));
    const [bufferQueuedToday] = await db.select({ value: count() }).from(articles)
      .where(and(eq(articles.status, "ready"), like(articles.facebookPostId, "buffer:%"), gte(articles.updatedAt, today)));
    const [enabledSourceCount] = await db.select({ value: count() }).from(rssSources).where(eq(rssSources.active, true));
    const [allSourceCount] = await db.select({ value: count() }).from(rssSources);
    const [publisherLock] = await db.select({ id: publisherState.id }).from(publisherState).limit(1);
    if (!publisherLock) throw new Error("Migration scheduler belum diterapkan.");
    const groupedStatuses = await db.select({ status: articles.status, value: count() }).from(articles).groupBy(articles.status);
    const feeds = await db.select().from(rssSources).orderBy(asc(rssSources.pageKey), asc(rssSources.name));
    const recentArticles = await db.select({
      id: articles.id,
      title: articles.title,
      category: articles.category,
      pageKey: articles.pageKey,
      sourceName: articles.sourceName,
      sourceUrl: articles.sourceUrl,
      status: articles.status,
      facebookPostId: articles.facebookPostId,
      errorMessage: articles.errorMessage,
      createdAt: articles.createdAt,
      publishedAt: articles.publishedAt,
    }).from(articles).orderBy(desc(articles.createdAt)).limit(20);

    const statusCounts: Record<ArticleStatus, number> = { queued: 0, processing: 0, ready: 0, published: 0, failed: 0 };
    for (const row of groupedStatuses) statusCounts[row.status] = row.value;

    const bufferApi = Boolean(process.env.BUFFER_API_KEY?.trim());
    const bufferChannels = {
      news: Boolean(process.env.BUFFER_NEWS_CHANNEL_ID?.trim()),
      entertainment: Boolean(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim()),
    };
    const hasConfiguredActiveFeed = feeds.some((feed) => feed.active && bufferChannels[feed.pageKey]);
    const integrations = {
      database: true,
      schema: true,
      feeds: enabledSourceCount.value > 0,
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_FALLBACK),
      groq: Boolean(process.env.GROQ_API_KEY),
      bufferApi,
      bufferNews: bufferChannels.news,
      bufferEntertainment: bufferChannels.entertainment,
      appUrl: Boolean(process.env.APP_URL),
      cronSecret: Boolean(process.env.CRON_SECRET),
    };

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      integrations,
      readyToPublish: integrations.feeds && (integrations.gemini || integrations.groq) && integrations.appUrl && integrations.cronSecret && integrations.bufferApi && hasConfiguredActiveFeed,
      schedule: PUBLISH_POLICY,
      stats: {
        articles: articleTotal.value,
        publishedToday: publishedToday.value,
        bufferQueuedToday: bufferQueuedToday.value,
        enabledFeeds: enabledSourceCount.value,
        totalFeeds: allSourceCount.value,
        ...statusCounts,
      },
      feeds,
      articles: recentArticles,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[dashboard]", error instanceof Error ? error.message : error);
    return NextResponse.json({
      ok: false,
      error: "Skema database belum lengkap. Jalankan migrasi drizzle/0003_scheduled_harvest.sql di Neon setelah migrasi RSS sebelumnya, lalu muat ulang dashboard.",
    }, { status: 503 });
  }
}
