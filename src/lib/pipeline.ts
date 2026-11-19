import "server-only";
import { and, asc, desc, eq, gt, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, type Article } from "@/lib/schema";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { MANUAL_REVIEW_SOURCE_NAME } from "@/lib/manual-review";
import { writeNewsCopy } from "@/lib/ai";
import { getBufferConfigurationGaps } from "@/lib/buffer";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { addPageComment, FacebookPublishOutcomeUnknownError, type PageKey } from "@/lib/facebook";
import { publishPost, usesDirectFacebookPublishing } from "@/lib/publisher";
import { getQueueExpiryCutoff, MAX_QUEUE_AGE_HOURS, isQueueItemExpired } from "@/lib/queue-policy";
import { indonesianTranslationUrl } from "@/lib/translation-url";
import { shortenArticleUrl } from "@/lib/shortlink";

const LOCK_STALE_MS = 30 * 60 * 1000;

async function claimNextArticle(): Promise<Article | null> {
  const db = getDb();
  const now = new Date();
  const expiryCutoff = getQueueExpiryCutoff(now);
  const expiredMessage = `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`;
  const isExpiredByAge = or(
    lt(articles.sourcePublishedAt, expiryCutoff),
    and(isNull(articles.sourcePublishedAt), lt(articles.createdAt, expiryCutoff)),
  );
  await db.update(articles)
    .set({ status: "expired", errorMessage: expiredMessage, updatedAt: now })
    .where(and(eq(articles.status, "queued"), isExpiredByAge));
  const configuredPages = (["news", "entertainment"] as const)
    .filter((pageKey) => getBufferConfigurationGaps([pageKey]).length === 0);
  if (!configuredPages.length) return null;
  const configuredPageFilter = or(...configuredPages.map((pageKey) => eq(articles.pageKey, pageKey)));
  if (!configuredPageFilter) return null;
  const [queued] = await db.select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.status, "queued"), configuredPageFilter))
    .orderBy(asc(articles.priorityAt), asc(sql`coalesce(${articles.sourcePublishedAt}, ${articles.createdAt})`))
    .limit(1);

  let candidateId = queued?.id;
  if (!candidateId) {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const [stale] = await db.select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.status, "processing"), configuredPageFilter, lt(articles.updatedAt, staleBefore)))
      .orderBy(asc(articles.updatedAt))
      .limit(1);
    if (stale?.id) {
      const staleId = stale.id;
      const [processingArticle] = await db.select({ sourcePublishedAt: articles.sourcePublishedAt, createdAt: articles.createdAt })
        .from(articles).where(eq(articles.id, staleId)).limit(1);
      if (processingArticle && isQueueItemExpired(processingArticle.sourcePublishedAt ?? processingArticle.createdAt, now)) {
        await db.update(articles)
          .set({ status: "expired", errorMessage: expiredMessage, updatedAt: now })
          .where(and(eq(articles.id, staleId), eq(articles.status, "processing")));
      } else {
        await db.update(articles)
          .set({ status: "queued", updatedAt: now })
          .where(and(eq(articles.id, staleId), eq(articles.status, "processing")));
        candidateId = staleId;
      }
    }
  }

  if (!candidateId) return null;
  const [claimed] = await db.update(articles)
    .set({ status: "processing", updatedAt: new Date(), errorMessage: null })
    .where(and(eq(articles.id, candidateId), eq(articles.status, "queued")))
    .returning();
  return claimed ?? null;
}

async function getPublishingPause(): Promise<{ detail: string; nextAllowedAt: string } | null> {
  const now = Date.now();
  const cutoff = new Date(now - PUBLISH_POLICY.maxPerHour * 60 * 60 * 1000);
  const db = getDb();
  const [facebookPublished, bufferQueued] = await Promise.all([
    db.select({ occurredAt: articles.publishedAt })
      .from(articles)
      .where(and(eq(articles.status, "published"), gt(articles.publishedAt, cutoff), ne(articles.sourceName, MANUAL_REVIEW_SOURCE_NAME)))
      .orderBy(desc(articles.publishedAt))
      .limit(PUBLISH_POLICY.maxPerHour),
    db.select({ occurredAt: articles.updatedAt })
      .from(articles)
      .where(and(eq(articles.status, "ready"), like(articles.facebookPostId, "buffer:%"), gt(articles.updatedAt, cutoff), ne(articles.sourceName, MANUAL_REVIEW_SOURCE_NAME)))
      .orderBy(desc(articles.updatedAt))
      .limit(PUBLISH_POLICY.maxPerHour),
  ]);
  const recent = [...facebookPublished, ...bufferQueued]
    .filter((item): item is { occurredAt: Date } => item.occurredAt instanceof Date)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, PUBLISH_POLICY.maxPerHour);
  const lastPublishedAt = recent[0]?.occurredAt.getTime();
  const minimumGapAt = lastPublishedAt === undefined ? now : lastPublishedAt + PUBLISH_POLICY.minimumGapMinutes * 60 * 1000;
  const oldestInWindow = recent[PUBLISH_POLICY.maxPerHour - 1];
  const hourlyLimitAt = recent.length >= PUBLISH_POLICY.maxPerHour && oldestInWindow
    ? oldestInWindow.occurredAt.getTime() + 60 * 60 * 1000
    : now;
  const nextAllowedAt = Math.max(minimumGapAt, hourlyLimitAt);
  if (nextAllowedAt <= now) return null;
  return {
    detail: recent.length >= PUBLISH_POLICY.maxPerHour
      ? `Batas publikasi tercapai: maksimal ${PUBLISH_POLICY.maxPerHour} artikel dalam 60 menit.`
      : `Jeda publikasi minimum ${PUBLISH_POLICY.minimumGapMinutes} menit belum terpenuhi.`,
    nextAllowedAt: new Date(nextAllowedAt).toISOString(),
  };
}

function getPublicAppUrl() {
  const raw = process.env.APP_URL;
  if (!raw) throw new Error("APP_URL belum diatur ke URL publik deployment Vercel.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL harus memakai HTTPS untuk deployment publik.");
  }
  return url.toString().replace(/\/$/, "");
}

export type RunResult = {
  result: "queued" | "published" | "idle" | "failed" | "rate-limited";
  articleId?: string;
  title?: string;
  detail?: string;
};

function publishingConfigurationGaps(pageKey: PageKey): string[] {
  return usesDirectFacebookPublishing(pageKey) ? [] : getBufferConfigurationGaps([pageKey]);
}

export async function runNewsPipeline(): Promise<RunResult> {
  const db = getDb();
  const pause = await getPublishingPause();
  if (pause) return { result: "rate-limited", detail: `${pause.detail} Berikutnya bisa mencoba setelah ${pause.nextAllowedAt}.` };
  const article = await claimNextArticle();
  if (!article) {
    const [blocked] = await db.select({ pageKey: articles.pageKey })
      .from(articles)
      .where(eq(articles.status, "queued"))
      .orderBy(asc(articles.createdAt))
      .limit(1);
    const missingChannel = blocked ? publishingConfigurationGaps(blocked.pageKey) : [];
    if (missingChannel.length) {
      return { result: "failed", detail: `Artikel tetap di antrean: ${missingChannel.join(", ")} belum diatur untuk Page ini.` };
    }
    return { result: "idle", detail: "Tidak ada berita baru di feed yang dikonfigurasi." };
  }

  const directFacebook = usesDirectFacebookPublishing(article.pageKey);

  // Validate the publish channel for this specific page before spending an AI call.
  const channelGaps = publishingConfigurationGaps(article.pageKey);
  if (channelGaps.length) {
    await db.update(articles)
      .set({ status: "queued", facebookPostId: null, updatedAt: new Date() })
      .where(and(eq(articles.id, article.id), eq(articles.status, "processing")));
    return {
      result: "failed",
      articleId: article.id,
      detail: `Artikel tetap di antrean: ${channelGaps.join(", ")} belum diatur untuk Page ini.`,
    };
  }

  const startedAt = Date.now();
  const logStage = (stage: string) => console.info(`[pipeline] article=${article.id} stage=${stage} elapsedMs=${Date.now() - startedAt}`);
  let publishProvider: "buffer" | "facebook" | null = null;
  let publishPostId: string | null = null;
  let publishMediaFormat: "single" | "carousel" | null = null;
  let carouselSlides: [string, string, string] | null = null;
  const pendingPrefix = directFacebook ? "facebook:pending" : "buffer:pending";

  try {
    logStage("ai-start");
    const copy = await writeNewsCopy({
      title: article.originalTitle,
      rawText: article.rawText,
      category: article.category,
      sourceName: article.sourceName,
    });
    logStage(`ai-complete provider=${copy.provider} model=${copy.model} elapsedMs=${copy.elapsedMs} attempts=${copy.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(",")}`);
    if (isQueueItemExpired(article.sourcePublishedAt ?? article.createdAt)) {
      await db.update(articles)
        .set({ status: "expired", errorMessage: `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`, updatedAt: new Date() })
        .where(and(eq(articles.id, article.id), eq(articles.status, "processing")));
      return { result: "idle", articleId: article.id, detail: "Berita melewati batas usia 7 jam saat diproses dan dikeluarkan dari antrean." };
    }
    const sourceLinkTarget = article.pageKey === "entertainment"
      ? indonesianTranslationUrl(article.sourceUrl)
      : article.sourceUrl;
    const shareLink = await shortenArticleUrl(sourceLinkTarget, article.id);
    const followLink = article.pageKey === "entertainment" ? "\n\nIkuti Popbeez: https://www.facebook.com/portalbeez" : "";
    // Direct Graph posts keep the caption link-free so Meta does not suppress reach;
    // the source link is posted as the first comment right after publishing.
    const caption = directFacebook
      ? `${copy.caption}\n\n📰 ${article.sourceName}`
      : `${copy.caption}\n\n📰 ${article.sourceName}\n🔗 Sumber: ${shareLink}${followLink}`;
    const firstComment = directFacebook ? `🔗 Sumber: ${shareLink}${followLink}` : "";
    carouselSlides = article.postFormat === "carousel" ? copy.carouselSlides : null;
    await db.update(articles)
      .set({
        title: copy.title,
        caption,
        carouselSlides,
        status: "ready",
        facebookPostId: `${pendingPrefix}:${article.id}`,
        updatedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(articles.id, article.id));

    const appUrl = getPublicAppUrl();
    const imageUrls = article.postFormat === "carousel"
      ? Array.from({ length: 4 }, (_, index) => `${appUrl}/api/og/${article.id}?slide=${index + 1}`)
      : [`${appUrl}/api/og/${article.id}`];
    logStage(`publish-start provider=${directFacebook ? "facebook" : "buffer"} format=${article.postFormat} assets=${imageUrls.length}`);
    const result = await publishPost({
      pageKey: article.pageKey,
      imageUrl: imageUrls[0]!,
      imageUrls,
      caption,
    });
    publishProvider = result.provider;
    publishPostId = result.postId;
    publishMediaFormat = result.mediaFormat;
    logStage(`publish-complete provider=${result.provider} format=${result.mediaFormat}`);

    if (result.provider === "facebook") {
      // Direct Graph publishing is public immediately; there is no Buffer schedule slot.
      await db.update(articles)
        .set({
          status: "published",
          postFormat: result.mediaFormat,
          carouselSlides: result.mediaFormat === "carousel" ? carouselSlides : null,
          facebookPostId: result.postId,
          publishedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(eq(articles.id, article.id));
      logStage("facebook-published");

      if (firstComment) {
        try {
          await addPageComment(article.pageKey, result.postId, firstComment);
          logStage("facebook-comment-added");
        } catch (commentError) {
          const commentMessage = commentError instanceof Error ? commentError.message : "Komentar sumber gagal dikirim.";
          await db.update(articles)
            .set({ errorMessage: `Posting berhasil; komentar sumber gagal: ${commentMessage}`.slice(0, 1_000), updatedAt: new Date() })
            .where(eq(articles.id, article.id));
          console.error(`[pipeline] komentar sumber gagal untuk ${article.id}:`, commentMessage);
          logStage("facebook-comment-failed");
        }
      }

      return {
        result: "published",
        articleId: article.id,
        title: copy.title,
        detail: "Posting langsung diterbitkan ke halaman Facebook Popbeez.",
      };
    }

    // Buffer menerima konten ke antreannya; Facebook akan menerbitkannya pada slot jadwal Buffer.
    // Gunakan prefix untuk membedakan ID Buffer dari ID posting Facebook lama tanpa migrasi schema.
    await db.update(articles)
      .set({ status: "ready", postFormat: result.mediaFormat, carouselSlides: result.mediaFormat === "carousel" ? carouselSlides : null, facebookPostId: `buffer:${result.postId}`, publishedAt: null, updatedAt: new Date(), errorMessage: null })
      .where(eq(articles.id, article.id));
    logStage("tracking-saved");

    return { result: "queued", articleId: article.id, title: copy.title, detail: "Konten masuk ke antrean Buffer untuk dijadwalkan." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan tidak diketahui saat memproses berita.";
    const outcomeUnknown = error instanceof BufferEnqueueOutcomeUnknownError || error instanceof FacebookPublishOutcomeUnknownError;

    if (outcomeUnknown || publishPostId) {
      const provider = publishProvider ?? (directFacebook ? "facebook" : "buffer");
      const trackingReference = publishPostId
        ? provider === "facebook" ? publishPostId : `buffer:${publishPostId}`
        : `${provider === "facebook" ? "facebook" : "buffer"}:pending:${article.id}`;
      let trackingRecovered = false;
      try {
        await db.update(articles)
          .set({
            status: provider === "facebook" && publishPostId ? "published" : "ready",
            postFormat: publishMediaFormat ?? article.postFormat,
            carouselSlides: (publishMediaFormat ?? article.postFormat) === "carousel" ? carouselSlides : null,
            facebookPostId: trackingReference,
            publishedAt: provider === "facebook" && publishPostId ? new Date() : null,
            errorMessage: outcomeUnknown ? `${message} Status tertunda untuk mencegah pengiriman duplikat.`.slice(0, 1_000) : null,
            updatedAt: new Date(),
          })
          .where(eq(articles.id, article.id));
        trackingRecovered = true;
      } catch (trackingError) {
        console.error(`[pipeline] tracking-recovery-failed article=${article.id}:`, trackingError instanceof Error ? trackingError.message : trackingError);
      }
      const detail = outcomeUnknown
        ? `${message} Status disimpan sebagai tertunda untuk mencegah pengiriman duplikat.`
        : trackingRecovered
          ? provider === "facebook"
            ? "Posting Facebook berhasil dibuat dan ID-nya disimpan setelah percobaan pemulihan database."
            : "Buffer menerima post dan ID antreannya berhasil disimpan setelah percobaan pemulihan database."
          : provider === "facebook"
            ? `Facebook sudah menerbitkan posting, tetapi penyimpanan ID-nya gagal. Periksa halaman sebelum mencoba lagi. ${message}`
            : `Buffer sudah menerima post, tetapi penyimpanan ID Buffer gagal. Periksa antrean sebelum mencoba lagi. ${message}`;
      logStage(outcomeUnknown ? "publish-outcome-unknown" : "tracking-recovery");
      console.error(`[pipeline] artikel ${article.id}:`, detail);
      return {
        result: outcomeUnknown || !trackingRecovered ? "failed" : provider === "facebook" ? "published" : "queued",
        articleId: article.id,
        detail,
      };
    }

    await db.update(articles)
      .set({ status: "failed", facebookPostId: null, attempts: article.attempts + 1, errorMessage: message.slice(0, 1_000), updatedAt: new Date() })
      .where(and(eq(articles.id, article.id), or(eq(articles.status, "processing"), eq(articles.status, "ready"))));
    logStage("failed");
    console.error(`[pipeline] artikel ${article.id}:`, message);
    return { result: "failed", articleId: article.id, detail: message };
  }
}
