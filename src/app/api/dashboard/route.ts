import { and, asc, count, desc, eq, gt, gte, inArray, isNull, like, lt, notLike, or, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { publishPolicy } from "@/lib/schedule";
import { PILLARS } from "@/lib/pillars";
import { slotStateAt } from "@/lib/publish-slots";
import { quizIntervalDays, QUIZ_MAX_USES, QUIZ_SCHEDULE_LABEL, QUIZ_TILES } from "@/lib/quiz";
import { minimumOriginalityScore } from "@/lib/originality";
import { articles, editorialDrafts, facebookPostInsights, publisherState, quizEditions, reels, rssSources } from "@/lib/schema";
import { EDITORIAL_VOICES } from "@/lib/editorial-voices";
import { getQueueExpiryCutoff, MAX_QUEUE_AGE_HOURS } from "@/lib/queue-policy";
import { isFacebookPublishingEnabled } from "@/lib/facebook";
import { isInstagramPublishingEnabled } from "@/lib/instagram";
import { getDiagnosticsSnapshot } from "@/lib/automation-log";
import { getContentManagerOverview } from "@/lib/content-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArticleStatus = "queued" | "processing" | "ready" | "published" | "failed" | "expired" | "removed";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Masukkan CRON_SECRET untuk membuka dashboard." }, { status: 401 });

  try {
    const db = getDb();
    const now = new Date();
    const expiryCutoff = getQueueExpiryCutoff(now);
    await db.update(articles)
      .set({ status: "expired", errorMessage: `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`, updatedAt: now })
      .where(and(
        eq(articles.status, "queued"),
        or(
          lt(articles.sourcePublishedAt, expiryCutoff),
          and(isNull(articles.sourcePublishedAt), lt(articles.createdAt, expiryCutoff)),
        ),
      ));
    await db.insert(publisherState).values({ id: 1 }).onConflictDoNothing();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const [articleTotal] = await db.select({ value: count() }).from(articles);
    const [publishedToday] = await db.select({ value: sql<number>`count(distinct coalesce(${articles.facebookPostId}, ${articles.id}::text))` }).from(articles)
      .where(and(eq(articles.status, "published"), gte(articles.publishedAt, today)));
    const [bufferQueuedToday] = await db.select({ value: sql<number>`count(distinct coalesce(${articles.facebookPostId}, ${articles.id}::text))` }).from(articles)
      .where(and(
        eq(articles.status, "ready"),
        like(articles.facebookPostId, "buffer:%"),
        notLike(articles.facebookPostId, "buffer:pending:%"),
        gte(articles.updatedAt, today),
      ));
    const [enabledSourceCount] = await db.select({ value: count() }).from(rssSources).where(eq(rssSources.active, true));
    const [allSourceCount] = await db.select({ value: count() }).from(rssSources);
    const [publisherLock] = await db.select({ id: publisherState.id }).from(publisherState).limit(1);
    if (!publisherLock) throw new Error("Migration scheduler belum diterapkan.");
    const groupedStatuses = await db.select({ status: articles.status, value: count() }).from(articles).groupBy(articles.status);
    const feeds = await db.select().from(rssSources).orderBy(asc(rssSources.pageKey), asc(rssSources.name));
    const articleFields = {
      id: articles.id,
      title: articles.title,
      category: articles.category,
      pageKey: articles.pageKey,
      sourceName: articles.sourceName,
      sourceUrl: articles.sourceUrl,
      imageUrl: articles.imageUrl,
      imageUrls: articles.imageUrls,
      manualImageUrls: articles.manualImageUrls,
      status: articles.status,
      facebookPostId: articles.facebookPostId,
      errorMessage: articles.errorMessage,
      createdAt: articles.createdAt,
      sourcePublishedAt: articles.sourcePublishedAt,
      priorityAt: articles.priorityAt,
      postFormat: articles.postFormat,
      carouselSlides: articles.carouselSlides,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
    };
    // The originality columns arrive with drizzle/0011; fall back to neutral values
    // so the dashboard keeps loading before that migration runs.
    let instagramSchemaReady = true;
    const instagramFields = { instagramMediaId: articles.instagramMediaId };
    const legacyInstagramFields = { instagramMediaId: sql<string | null>`null` };
    let originalitySchemaReady = true;
    const originalityFields = {
      editorialTake: articles.editorialTake,
      originalityScore: articles.originalityScore,
      originalityNotes: articles.originalityNotes,
      editorialVoice: articles.editorialVoice,
      narrationScript: articles.narrationScript,
    };
    const legacyOriginalityFields = {
      editorialTake: sql<string | null>`null`,
      originalityScore: sql<number>`0`,
      originalityNotes: sql<never>`null`,
      editorialVoice: sql<string | null>`null`,
      narrationScript: sql<string | null>`null`,
    };
    // Two groups keep the dashboard readable: rows still waiting in the local
    // queue, and rows a publisher cycle already handled (in-flight, accepted by
    // Buffer, live on Facebook, or failed). The client splits them again with
    // `splitArticleSections` from `@/lib/article-sections`.
    const loadRows = (fields: Parameters<typeof db.select>[0]) => Promise.all([
      db.select(fields).from(articles).where(eq(articles.status, "queued"))
        .orderBy(asc(articles.priorityAt), asc(sql`coalesce(${articles.sourcePublishedAt}, ${articles.createdAt})`)),
      db.select(fields).from(articles)
        .where(inArray(articles.status, ["processing", "ready", "published", "failed"]))
        .orderBy(desc(sql`coalesce(${articles.publishedAt}, ${articles.updatedAt})`)).limit(20),
    ]);
    let rows: Awaited<ReturnType<typeof loadRows>>;
    try {
      rows = await loadRows({ ...articleFields, ...instagramFields, ...originalityFields });
    } catch {
      try {
        rows = await loadRows({ ...articleFields, ...instagramFields, ...legacyOriginalityFields });
        originalitySchemaReady = false;
      } catch {
        // drizzle/0013 not applied yet: keep the dashboard usable without the IG link.
        instagramSchemaReady = false;
        rows = await loadRows({ ...articleFields, ...legacyInstagramFields, ...legacyOriginalityFields });
      }
    }
    const [queueRows, doneRows] = rows;
    const dashboardArticles = [
      ...queueRows.map((article, index) => ({ ...article, queuePosition: index + 1 })),
      ...doneRows.map((article) => ({ ...article, queuePosition: null })),
    ];

    // The quiz table arrives with drizzle/0010; the dashboard must keep working before that migration runs.
    let lastQuiz: { postedAt: Date | null; imageUrl: string | null; facebookPostId: string | null; posterKeys: string[]; answerKey: Array<{ title: string; sourceUrl: string | null; reviewId: string }>; errorMessage: string | null } | null = null;
    let quizSchemaReady = true;
    try {
      const [row] = await db.select({
        postedAt: quizEditions.postedAt,
        imageUrl: quizEditions.imageUrl,
        facebookPostId: quizEditions.facebookPostId,
        posterKeys: quizEditions.posterKeys,
        answerKey: quizEditions.answerKey,
        errorMessage: quizEditions.errorMessage,
      }).from(quizEditions).orderBy(desc(quizEditions.createdAt)).limit(1);
      lastQuiz = row ?? null;
    } catch {
      quizSchemaReady = false;
    }

    // Preview-before-publish flows and editorial attribution arrive in migration 0019.
    let popbeezEditorialSchemaReady = true;
    try {
      await Promise.all([
        db.select({ segment: articles.segment, contentFormat: articles.contentFormat }).from(articles).limit(1),
        db.select({ answerKey: quizEditions.answerKey, segment: quizEditions.segment, contentFormat: quizEditions.contentFormat }).from(quizEditions).limit(1),
        db.select({ segment: reels.segment, contentFormat: reels.contentFormat, pillar: reels.pillar }).from(reels).limit(1),
        db.select({ id: editorialDrafts.id }).from(editorialDrafts).limit(1),
        db.select({ availableMetrics: facebookPostInsights.availableMetrics }).from(facebookPostInsights).limit(1),
      ]);
    } catch {
      popbeezEditorialSchemaReady = false;
    }

    // Originality guard summary: how much of the recent output clears the "substantial addition" bar.
    const originalityThreshold = minimumOriginalityScore();
    let scoredRows: { score: number; status: ArticleStatus }[] = [];
    try {
      scoredRows = await db.select({ score: articles.originalityScore, status: articles.status })
        .from(articles)
        .where(gt(articles.originalityScore, 0))
        .orderBy(desc(articles.createdAt))
        .limit(60);
    } catch {
      originalitySchemaReady = false;
    }
    const originality = {
      schemaReady: originalitySchemaReady,
      threshold: originalityThreshold,
      scored: scoredRows.length,
      /** Average of the recent scores, rounded; 0 when nothing has been scored yet. */
      average: scoredRows.length ? Math.round(scoredRows.reduce((total, row) => total + row.score, 0) / scoredRows.length) : 0,
      safe: scoredRows.filter((row) => row.score >= 65).length,
      watch: scoredRows.filter((row) => row.score >= originalityThreshold && row.score < 65).length,
      risky: scoredRows.filter((row) => row.score < originalityThreshold).length,
      held: scoredRows.filter((row) => row.status === "failed" && row.score < originalityThreshold).length,
    };

    // Reels ship with drizzle/0012; the dashboard must still load before it runs.
    let reelsSchemaReady = true;
    let lastReel: { videoUrl: string | null; facebookVideoId: string | null; status: string; voiceLabel: string | null; errorMessage: string | null; durationSeconds: number; frameCount: number; createdAt: Date } | null = null;
    let reelCount = 0;
    try {
      const [row] = await db.select({
        videoUrl: reels.videoUrl,
        facebookVideoId: reels.facebookVideoId,
        status: reels.status,
        voiceLabel: reels.voiceLabel,
        errorMessage: reels.errorMessage,
        durationSeconds: reels.durationSeconds,
        frameCount: reels.frameCount,
        createdAt: reels.createdAt,
      }).from(reels).orderBy(desc(reels.createdAt)).limit(1);
      lastReel = row ?? null;
      const [total] = await db.select({ value: count() }).from(reels).where(eq(reels.status, "published"));
      reelCount = total?.value ?? 0;
    } catch {
      reelsSchemaReady = false;
    }
    const reelsSummary = {
      schemaReady: reelsSchemaReady,
      enabled: process.env.REELS_ENABLED?.trim() === "1",
      published: reelCount,
      last: lastReel,
      minGapHours: Number(process.env.REELS_MIN_GAP_HOURS?.trim() || 20),
      ttsVoice: process.env.REELS_TTS_VOICE?.trim() || "id-ID-GadisNeural",
      renderMode: process.env.REELS_RENDER_URL?.trim() ? "worker" : process.env.FFMPEG_PATH?.trim() ? "ffmpeg-lokal" : "belum-disetel",
      voices: EDITORIAL_VOICES.map((voice) => ({ id: voice.id, label: voice.label, summary: voice.summary })),
    };

    const statusCounts: Record<ArticleStatus, number> = { queued: 0, processing: 0, ready: 0, published: 0, failed: 0, expired: 0, removed: 0 };
    for (const row of groupedStatuses) statusCounts[row.status] = row.value;

    const bufferApi = Boolean(process.env.BUFFER_API_KEY?.trim());
    const bufferChannels = {
      news: Boolean(process.env.BUFFER_NEWS_CHANNEL_ID?.trim()),
      entertainment: Boolean(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim()),
    };
    const facebookEntertainment = isFacebookPublishingEnabled("entertainment");
    const newsReady = bufferApi && bufferChannels.news;
    const entertainmentReady = facebookEntertainment || (bufferApi && bufferChannels.entertainment);
    const hasConfiguredActiveFeed = feeds.some((feed) => feed.active && (feed.pageKey === "news" ? newsReady : entertainmentReady));
    const integrations = {
      database: true,
      schema: true,
      feeds: enabledSourceCount.value > 0,
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY_FALLBACK?.trim()),
      groq: Boolean(process.env.GROQ_API_KEY?.trim()),
      openRouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      bufferApi,
      bufferNews: bufferChannels.news,
      bufferEntertainment: bufferChannels.entertainment,
      facebookEntertainment,
      instagram: isInstagramPublishingEnabled(),
      instagramSchema: instagramSchemaReady,
      appUrl: Boolean(process.env.APP_URL),
      cronSecret: Boolean(process.env.CRON_SECRET),
      blobStorage: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
    };

    const [diagnostics, contentManager] = await Promise.all([
      getDiagnosticsSnapshot(20).catch(() => null),
      getContentManagerOverview(12).catch(() => null),
    ]);
    const integrationStatus = {
      ...integrations,
      contentManagerSchema: contentManager?.schemaReady ?? false,
    };

    return NextResponse.json({
      ok: true,
      version: "3.0.0",
      checkedAt: new Date().toISOString(),
      diagnostics,
      contentManager,
      popbeezEditorialSchemaReady,
      integrations: integrationStatus,
      aiModels: {
        groq: process.env.GROQ_MODEL?.trim().slice(0, 100) || "otomatis (router v3 · batas OTPM aman)",
        gemini: process.env.GEMINI_MODEL?.trim().slice(0, 100) || "otomatis (model Gemini tersedia)",
        openRouter: process.env.OPENROUTER_MODEL?.trim().slice(0, 100) || "otomatis (model gratis :free)",
      },
      readyToPublish: integrations.feeds && (integrations.gemini || integrations.groq || integrations.openRouter) && integrations.appUrl && integrations.cronSecret && (newsReady || entertainmentReady) && hasConfiguredActiveFeed,
      originality,
      reels: reelsSummary,
      schedule: publishPolicy(),
      pillars: { list: Object.values(PILLARS).map(({ id, label, summary, share }) => ({ id, label, summary, share })) },
      publishSchedule: slotStateAt(new Date()),
      quiz: {
        lastPostedAt: lastQuiz?.postedAt ?? null,
        lastImageUrl: lastQuiz?.imageUrl ?? null,
        lastPostId: lastQuiz?.facebookPostId ?? null,
        lastError: lastQuiz?.errorMessage ?? null,
        tiles: lastQuiz?.posterKeys.length ?? QUIZ_TILES,
        answerKey: lastQuiz?.answerKey ?? [],
        maxUses: QUIZ_MAX_USES,
        intervalDays: quizIntervalDays(),
        schedule: QUIZ_SCHEDULE_LABEL,
        schemaReady: quizSchemaReady,
      },
      stats: {
        articles: articleTotal.value,
        publishedToday: publishedToday.value,
        bufferQueuedToday: bufferQueuedToday.value,
        enabledFeeds: enabledSourceCount.value,
        totalFeeds: allSourceCount.value,
        ...statusCounts,
      },
      feeds,
      articles: dashboardArticles,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[dashboard]", error instanceof Error ? error.message : error);
    return NextResponse.json({
      ok: false,
      error: "Skema database belum lengkap. Pastikan DATABASE_URL mengarah ke Neon yang benar, lalu jalankan migrasi yang belum diterapkan berurutan, termasuk drizzle/0019_popbeez_segments_bio_drafts.sql, dan muat ulang dashboard.",
    }, { status: 503 });
  }
}
