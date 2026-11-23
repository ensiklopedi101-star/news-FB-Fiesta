import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, like, lt, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, type Article } from "@/lib/schema";
import { publishPolicy } from "@/lib/schedule";
import { classifyPillar, type Pillar } from "@/lib/pillars";
import { POPBEEZ_ROUNDUP_MIN, roundupSlideUrls, selectedRoundupImage, selectRoundup } from "@/lib/roundup";
import { witaDayNumber } from "@/lib/publish-slots";
import { MANUAL_REVIEW_SOURCE_NAMES } from "@/lib/manual-review";
import { writeNewsCopy, type GeneratedCopy } from "@/lib/ai";
import { getBufferConfigurationGaps } from "@/lib/buffer";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { addPageComment, FacebookPublishOutcomeUnknownError, type PageKey } from "@/lib/facebook";
import { isInstagramPublishingEnabled, publishInstagramPost } from "@/lib/instagram";
import { publishPost, usesDirectFacebookPublishing } from "@/lib/publisher";
import { getQueueExpiryCutoff, MAX_QUEUE_AGE_HOURS, isQueueItemExpired } from "@/lib/queue-policy";
import { pickEditorialVoice } from "@/lib/editorial-voices";
import { indonesianTranslationUrl } from "@/lib/translation-url";
import { shortenArticleUrl } from "@/lib/shortlink";
import {
  originalityBlocked,
  originalityMaxAttempts,
  scoreOriginality,
  shouldRetryForOriginality,
  stripHeadlineFromSourceText,
  type OriginalityReport,
} from "@/lib/originality";

const LOCK_STALE_MS = 30 * 60 * 1000;
const WITA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Midnight of the current WITA day, expressed as a UTC instant. */
function witaDayStart(now: Date): Date {
  return new Date(witaDayNumber(now) * 86_400_000 - WITA_OFFSET_MS);
}

/** Postgres 42703 when a migration has not been applied yet. */
function isMissingColumnError(error: unknown, column: string): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (code === "42703" || /does not exist/i.test(message)) && message.includes(column);
}


async function claimNextArticles(): Promise<Article[]> {
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
  if (!configuredPages.length) return [];
  const configuredPageFilter = or(...configuredPages.map((pageKey) => eq(articles.pageKey, pageKey)));
  if (!configuredPageFilter) return [];
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);

  // PopBeez (entertainment) is assembled as one ordered Feed roundup. Pillars
  // provide a soft diversity preference only; no mix is rejected as a rule.
  let selectedIds: string[] = [];
  if (configuredPages.includes("entertainment")) {
    const rows = await db.select({ id: articles.id, title: articles.title, category: articles.category, imageUrl: articles.imageUrl, imageUrls: articles.imageUrls, manualImageUrls: articles.manualImageUrls })
      .from(articles)
      .where(and(eq(articles.status, "queued"), eq(articles.pageKey, "entertainment")))
      .orderBy(asc(articles.priorityAt), asc(sql`coalesce(${articles.sourcePublishedAt}, ${articles.createdAt})`))
      .limit(30);
    const eligibleRows = rows.filter((row) => selectedRoundupImage(row));
    const selection = selectRoundup(eligibleRows.map((row) => ({ ...row, pillar: classifyPillar(row) })));
    selectedIds = selection?.map((row) => row.id) ?? [];
    // Three queued stories are held for the minimum four-card treatment. Keep
    // other configured Pages moving rather than blocking their queue as well.
  }
  if (!selectedIds.length && configuredPages.includes("news")) {
    const [news] = await db.select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.status, "queued"), eq(articles.pageKey, "news")))
      .orderBy(asc(articles.priorityAt), asc(sql`coalesce(${articles.sourcePublishedAt}, ${articles.createdAt})`))
      .limit(1);
    if (news) selectedIds = [news.id];
  }

  if (!selectedIds.length) {
    // Recover a stale claim as a whole batch, never leaving roundup companions
    // stranded in `processing` if the worker died before publishing.
    const [stale] = await db.select({ id: articles.id, facebookPostId: articles.facebookPostId })
      .from(articles)
      .where(and(eq(articles.status, "processing"), configuredPageFilter, lt(articles.updatedAt, staleBefore)))
      .orderBy(asc(articles.updatedAt)).limit(1);
    if (stale?.id) {
      const claimGroup = stale.facebookPostId?.startsWith("claim:")
        ? eq(articles.facebookPostId, stale.facebookPostId)
        : eq(articles.id, stale.id);
      const staleProcessing = and(eq(articles.status, "processing"), configuredPageFilter, lt(articles.updatedAt, staleBefore), claimGroup);
      await db.update(articles)
        .set({ status: "expired", errorMessage: expiredMessage, facebookPostId: null, updatedAt: new Date() })
        .where(and(staleProcessing, isExpiredByAge));
      await db.update(articles)
        .set({ status: "queued", facebookPostId: null, updatedAt: new Date() })
        .where(staleProcessing);
    }
    return [];
  }

  const claimedRows = await db.update(articles)
    .set({ status: "processing", facebookPostId: `claim:${selectedIds[0]}`, updatedAt: new Date(), errorMessage: null })
    .where(and(inArray(articles.id, selectedIds), eq(articles.status, "queued")))
    .returning();
  const byId = new Map(claimedRows.map((row) => [row.id, row]));
  // Only publish a complete claimed group. If another worker raced the claim,
  // release any partial claim and wait for the next cycle.
  if (claimedRows.length !== selectedIds.length) {
    if (claimedRows.length) {
      await db.update(articles).set({ status: "queued", facebookPostId: null, updatedAt: new Date() })
        .where(and(inArray(articles.id, claimedRows.map((row) => row.id)), eq(articles.status, "processing")));
    }
    return [];
  }
  return selectedIds.map((id) => byId.get(id)!);
}

async function getPublishingPause(): Promise<{ detail: string; nextAllowedAt: string } | null> {
  const policy = publishPolicy();
  const now = Date.now();
  const dayStart = witaDayStart(new Date(now));
  const cutoff = new Date(now - policy.maxPerHour * 60 * 60 * 1000);
  const db = getDb();
  const [facebookPublished, bufferQueued] = await Promise.all([
    db.select({ occurredAt: articles.publishedAt, postKey: sql<string>`coalesce(${articles.facebookPostId}, ${articles.id}::text)` })
      .from(articles)
      .where(and(eq(articles.status, "published"), gt(articles.publishedAt, cutoff), notInArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES])))
      .orderBy(desc(articles.publishedAt))
      .limit(100),
    db.select({ occurredAt: articles.updatedAt, postKey: sql<string>`coalesce(${articles.facebookPostId}, ${articles.id}::text)` })
      .from(articles)
      .where(and(eq(articles.status, "ready"), like(articles.facebookPostId, "buffer:%"), gt(articles.updatedAt, cutoff), notInArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES])))
      .orderBy(desc(articles.updatedAt))
      .limit(100),
  ]);
  const uniquePosts = new Map<string, Date>();
  for (const item of [...facebookPublished, ...bufferQueued]) {
    if (!(item.occurredAt instanceof Date)) continue;
    const previous = uniquePosts.get(item.postKey);
    if (!previous || item.occurredAt > previous) uniquePosts.set(item.postKey, item.occurredAt);
  }
  const recent = [...uniquePosts.values()]
    .sort((a, b) => b.getTime() - a.getTime())
    .slice(0, policy.maxPerHour);

  // Daily ceiling: four posts per WITA day by default, matching the four configured slots.
  const todayRows = await getDb()
    .select({ value: sql<number>`count(distinct coalesce(${articles.facebookPostId}, ${articles.id}::text))` })
    .from(articles)
    .where(and(
      or(eq(articles.status, "published"), like(articles.facebookPostId, "buffer:%")),
      gt(sql`coalesce(${articles.publishedAt}, ${articles.updatedAt})`, dayStart),
      notInArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES]),
    ))
    .catch(() => [{ value: 0 }]);
  const todaysPosts = Number(todayRows[0]?.value ?? 0);
  if (todaysPosts >= policy.maxPerDay) {
    const tomorrow = new Date((witaDayNumber(new Date(now)) + 1) * 86_400_000 - WITA_OFFSET_MS);
    return {
      detail: `Kuota harian tercapai: sudah ${todaysPosts}/${policy.maxPerDay} post hari ini. Lanjut besok pagi.`,
      nextAllowedAt: tomorrow.toISOString(),
    };
  }

  const lastPublishedAt = recent[0]?.getTime();
  const minimumGapAt = lastPublishedAt === undefined ? now : lastPublishedAt + policy.minimumGapMinutes * 60 * 1000;
  const oldestInWindow = recent[policy.maxPerHour - 1];
  const hourlyLimitAt = recent.length >= policy.maxPerHour && oldestInWindow
    ? oldestInWindow.getTime() + 60 * 60 * 1000
    : now;
  const nextAllowedAt = Math.max(minimumGapAt, hourlyLimitAt);
  if (nextAllowedAt <= now) return null;
  return {
    detail: recent.length >= policy.maxPerHour
      ? `Batas per jam tercapai: maksimal ${policy.maxPerHour} post dalam 60 menit.`
      : `Jeda publikasi minimum ${policy.minimumGapMinutes} menit belum terpenuhi.`,
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

/** Time budget for one AI draft. Two drafts must still fit the cron window. */
const AI_DRAFT_BUDGET_MS = 30_000;

/**
 * Writes the copy and keeps rewriting while the originality guard objects, so a
 * weak first draft is fixed without a human pressing "Tulis ulang caption".
 * A failed rewrite keeps the previous draft: the article must not fail because
 * the second AI call (or its budget) fell over.
 */
async function writeGuardedCopy(
  article: Article,
  logStage: (stage: string) => void,
  strictFirstDraft: boolean,
  roundupArticles: Article[] = [],
): Promise<{ copy: GeneratedCopy; originality: OriginalityReport; drafts: number; pillar: Pillar }> {
  const maxDrafts = originalityMaxAttempts();
  const voice = pickEditorialVoice(article.id);
  const score = (copy: GeneratedCopy) => scoreOriginality({
    caption: copy.caption,
    take: copy.take,
    question: copy.question,
    // Roundup headlines are localized for readers; compare the caption with source
    // bodies after stripping source headlines to avoid counting attribution as copying.
    sourceText: (roundupArticles.length ? roundupArticles : [article])
      .map((story) => stripHeadlineFromSourceText(story.originalTitle, story.rawText))
      .join("\n\n"),
    title: article.originalTitle,
  });

  const pillar = classifyPillar({ title: article.originalTitle, category: article.category });
  logStage(`pillar=${pillar}`);
  let copy = await writeNewsCopy({
    title: article.originalTitle,
    rawText: article.rawText,
    category: article.category,
    sourceName: article.sourceName,
    strictOriginality: strictFirstDraft,
    budgetMs: AI_DRAFT_BUDGET_MS,
    voice,
    pillar,
    ...(roundupArticles.length > 1 ? { roundupArticles: roundupArticles.map((story) => ({ title: story.originalTitle, sourceName: story.sourceName, category: story.category, rawText: story.rawText })) } : {}),
  });
  let originality = score(copy);
  let drafts = 1;
  logStage(`originality score=${originality.score} band=${originality.band} overlap=${originality.overlap} longestRun=${originality.longestRun} draft=${drafts} voice=${voice.id}`);

  while (shouldRetryForOriginality(originality, drafts, maxDrafts)) {
    logStage(`originality-rewrite draft=${drafts + 1} previous=${originality.score}`);
    try {
      const rewritten = await writeNewsCopy({
        title: article.originalTitle,
        rawText: article.rawText,
        category: article.category,
        sourceName: article.sourceName,
        strictOriginality: true,
        pillar,
        feedback: [
          ...originality.reasons,
          ...(originality.matchedPhrase && !originality.signals.noVerbatim
            ? [`Frasa sumber yang harus diparafrasekan secara menyeluruh (kutipan data): “${originality.matchedPhrase}”.`]
            : []),
        ].join(" "),
        budgetMs: AI_DRAFT_BUDGET_MS,
        voice,
        ...(roundupArticles.length > 1 ? { roundupArticles: roundupArticles.map((story) => ({ title: story.originalTitle, sourceName: story.sourceName, category: story.category, rawText: story.rawText })) } : {}),
      });
      copy = rewritten;
      originality = score(rewritten);
      drafts += 1;
      logStage(`originality score=${originality.score} band=${originality.band} overlap=${originality.overlap} longestRun=${originality.longestRun} draft=${drafts}`);
    } catch (error) {
      logStage(`originality-rewrite-failed draft=${drafts + 1} reason=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
      break;
    }
  }

  if (originalityBlocked(originality)) {
    logStage(`originality-blocked score=${originality.score} drafts=${drafts}`);
  }
  return { copy, originality, drafts, pillar };
}

/**
 * Stores the editorial take and the originality audit. The columns ship with
 * `drizzle/0011_originality.sql`; until that migration runs the publish path must
 * keep working, so a failure here is logged and ignored.
 */
async function recordOriginality(
  articleId: string,
  editorial: { take: string; voiceId: string | null; narration: string },
  report: OriginalityReport,
) {
  try {
    await getDb().update(articles)
      .set({
        editorialTake: editorial.take,
        editorialVoice: editorial.voiceId,
        narrationScript: editorial.narration,
        originalityScore: report.score,
        originalityNotes: report,
      })
      .where(eq(articles.id, articleId));
  } catch (error) {
    console.warn(`[pipeline] originality-persist-skipped reason=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
  }
}

export async function runNewsPipeline(): Promise<RunResult> {
  const db = getDb();
  const pause = await getPublishingPause();
  if (pause) return { result: "rate-limited", detail: `${pause.detail} Berikutnya bisa mencoba setelah ${pause.nextAllowedAt}.` };
  const claimedArticles = await claimNextArticles();
  const article = claimedArticles[0];
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
    const popbeezQueued = await db.select({
      imageUrl: articles.imageUrl,
      imageUrls: articles.imageUrls,
      manualImageUrls: articles.manualImageUrls,
    }).from(articles)
      .where(and(eq(articles.status, "queued"), eq(articles.pageKey, "entertainment")));
    if (popbeezQueued.length) {
      const imageReady = popbeezQueued.filter((row) => selectedRoundupImage(row)).length;
      return {
        result: "idle",
        detail: `Feed Hiburan menunggu carousel tepat 4 gambar: ${imageReady}/4 artikel antrean punya gambar yang layak (total antrean ${popbeezQueued.length}).`,
      };
    }
    return { result: "idle", detail: "Tidak ada berita baru di feed yang dikonfigurasi." };
  }

  const isRoundup = article.pageKey === "entertainment" && claimedArticles.length === POPBEEZ_ROUNDUP_MIN;
  const roundupArticles = isRoundup ? claimedArticles : [];
  const articleIds = claimedArticles.map((story) => story.id);
  const directFacebook = usesDirectFacebookPublishing(article.pageKey);

  // Validate the publish channel for this specific page before spending an AI call.
  const channelGaps = publishingConfigurationGaps(article.pageKey);
  if (channelGaps.length) {
    await db.update(articles)
      .set({ status: "queued", facebookPostId: null, updatedAt: new Date() })
      .where(and(inArray(articles.id, articleIds), eq(articles.status, "processing")));
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
  let carouselSlides: string[] | null = null;
  const postFormat = isRoundup ? "carousel" : article.pageKey === "entertainment" ? "single" : article.postFormat;
  const pendingPrefix = directFacebook ? "facebook:pending" : "buffer:pending";

  try {
    logStage("ai-start");
    // A retried article that was previously held by the originality guard gets the
    // stricter brief, so the rewrite is less likely to fail the same way again.
    const retryingHeldCopy = Boolean(article.errorMessage?.startsWith("Ditahan oleh penjaga orisinalitas"));
    const { copy, originality, drafts, pillar } = await writeGuardedCopy(article, logStage, retryingHeldCopy, roundupArticles);
    logStage(`ai-complete provider=${copy.provider} model=${copy.model} elapsedMs=${copy.elapsedMs} drafts=${drafts} attempts=${copy.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`).join(",")}`);

    if (isQueueItemExpired(article.sourcePublishedAt ?? article.createdAt)) {
      await db.update(articles)
        .set({ status: "expired", errorMessage: `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`, updatedAt: new Date() })
        .where(and(inArray(articles.id, articleIds), eq(articles.status, "processing")));
      return { result: "idle", articleId: article.id, detail: "Berita melewati batas usia 7 jam saat diproses dan dikeluarkan dari antrean." };
    }
    if (originalityBlocked(originality)) {
      await db.update(articles)
        .set({
          status: "failed",
          facebookPostId: null,
          attempts: article.attempts + 1,
          errorMessage: `Ditahan oleh penjaga orisinalitas setelah ${drafts} percobaan (skor ${originality.score}/100). ${originality.reasons.join(" ")}`.slice(0, 1_000),
          updatedAt: new Date(),
        })
        .where(and(inArray(articles.id, articleIds), eq(articles.status, "processing")));
      await recordOriginality(article.id, { take: copy.take, voiceId: copy.voiceId, narration: copy.narration }, originality);
      return {
        result: "failed",
        articleId: article.id,
        title: copy.title,
        detail: `Ditahan setelah ${drafts} percobaan: orisinalitas ${originality.score}/100. ${originality.reasons[0]}`,
      };
    }
    const sourceStories = isRoundup ? roundupArticles : [article];
    const sourceLinks = await Promise.all(sourceStories.map(async (story) => {
      const target = story.pageKey === "entertainment" ? indonesianTranslationUrl(story.sourceUrl) : story.sourceUrl;
      return { name: story.sourceName, url: await shortenArticleUrl(target, story.id) };
    }));
    const sourceBlock = sourceLinks.map((source, index) => `${index + 1}. ${source.name}: ${source.url}`).join("\n");
    const followLink = article.pageKey === "entertainment"
      ? "\n\nIkuti PopBeez: https://www.facebook.com/portalbeez\nFollow juga Instagram: https://www.instagram.com/popbeez.hive/"
      : "";
    // Direct Graph posts keep caption links out of the post; ordered sources go
    // into the first comment. Buffer captions retain an ordered source list.
    const caption = directFacebook
      ? copy.caption
      : isRoundup
        ? `${copy.caption}\n\n📰 Sumber:\n${sourceBlock}${followLink}`
        : `${copy.caption}\n\n📰 ${article.sourceName}\n🔗 Sumber: ${sourceLinks[0]!.url}${followLink}`;
    const firstComment = directFacebook ? `📰 Sumber:\n${sourceBlock}${followLink}` : "";
    carouselSlides = isRoundup ? copy.carouselSlides : postFormat === "carousel" ? copy.carouselSlides : null;
    // `pillar` lives in migration 0015. If that SQL has not been run yet the write
    // would fail and a finished article would never publish, so fall back to the
    // same row without the pillar instead of losing the post.
    const readyRow = {
      title: copy.title,
      caption,
      carouselSlides,
      postFormat,
      status: "ready" as const,
      facebookPostId: `${pendingPrefix}:${article.id}`,
      updatedAt: new Date(),
      errorMessage: null,
    };
    try {
      await db.update(articles)
        .set({ ...readyRow, pillar })
        .where(eq(articles.id, article.id));
    } catch (error) {
      if (!isMissingColumnError(error, "pillar")) throw error;
      logStage("pillar-column-missing: jalankan drizzle/0015_content_pillars.sql");
      await db.update(articles)
        .set(readyRow)
        .where(eq(articles.id, article.id));
    }
    if (articleIds.length > 1) {
      await Promise.all(articleIds.map((storyId, index) => db.update(articles).set({
        ...(index > 0 && copy.roundupTitles?.[index] ? { title: copy.roundupTitles[index] } : {}),
        status: "ready",
        postFormat,
        facebookPostId: `${pendingPrefix}:${article.id}`,
        updatedAt: new Date(),
      }).where(eq(articles.id, storyId))));
    }
    await recordOriginality(article.id, { take: copy.take, voiceId: copy.voiceId, narration: copy.narration }, originality);

    const appUrl = getPublicAppUrl();
    const imageUrls = isRoundup
      ? roundupSlideUrls(appUrl, article.id, articleIds, copy.roundupTitles ?? [])
      : postFormat === "carousel"
        ? Array.from({ length: 4 }, (_, index) => `${appUrl}/api/og/${article.id}?slide=${index + 1}`)
        : [`${appUrl}/api/og/${article.id}`];
    logStage(`publish-start provider=${directFacebook ? "facebook" : "buffer"} format=${postFormat} assets=${imageUrls.length}`);
    const result = await publishPost({
      pageKey: article.pageKey,
      imageUrl: imageUrls[0]!,
      imageUrls,
      caption,
      strictCarousel: isRoundup,
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
          facebookPostId: result.postId,
          publishedAt: new Date(),
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(inArray(articles.id, articleIds));
      if (isRoundup) await db.update(articles).set({ carouselSlides }).where(eq(articles.id, article.id));
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

      // Mirror to Instagram. A failure here is reported but never rolls back the
      // Facebook post, exactly like the source comment.
      let instagramNote = "";
      if (isInstagramPublishingEnabled()) {
        try {
          const instagram = await publishInstagramPost({ imageUrls, caption });
          await db.update(articles)
            .set({ instagramMediaId: instagram.mediaId, updatedAt: new Date() })
            .where(eq(articles.id, article.id))
            .catch(() => undefined);
          logStage(`instagram-published media=${instagram.mediaId}`);
        } catch (instagramError) {
          const instagramMessage = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
          instagramNote = ` Instagram belum terkirim: ${instagramMessage.slice(0, 200)}`;
          await db.update(articles)
            .set({ errorMessage: `Posting Facebook berhasil; Instagram gagal: ${instagramMessage}`.slice(0, 1_000), updatedAt: new Date() })
            .where(eq(articles.id, article.id));
          console.error(`[pipeline] instagram gagal untuk ${article.id}:`, instagramMessage);
          logStage("instagram-failed");
        }
      }

      return {
        result: "published",
        articleId: article.id,
        title: copy.title,
        detail: `Posting langsung diterbitkan ke halaman Facebook PopBeez.${instagramNote}`,
      };
    }

    // Buffer menerima konten ke antreannya; Facebook akan menerbitkannya pada slot jadwal Buffer.
    // Gunakan prefix untuk membedakan ID Buffer dari ID posting Facebook lama tanpa migrasi schema.
    await db.update(articles)
      .set({ status: "ready", postFormat: result.mediaFormat, facebookPostId: `buffer:${result.postId}`, publishedAt: null, updatedAt: new Date(), errorMessage: null })
      .where(inArray(articles.id, articleIds));
    if (isRoundup) await db.update(articles).set({ carouselSlides }).where(eq(articles.id, article.id));
    else await db.update(articles).set({ carouselSlides: result.mediaFormat === "carousel" ? carouselSlides : null }).where(eq(articles.id, article.id));
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
            postFormat: publishMediaFormat ?? postFormat,
            facebookPostId: trackingReference,
            publishedAt: provider === "facebook" && publishPostId ? new Date() : null,
            errorMessage: outcomeUnknown ? `${message} Status tertunda untuk mencegah pengiriman duplikat.`.slice(0, 1_000) : null,
            updatedAt: new Date(),
          })
          .where(inArray(articles.id, articleIds));
        if (isRoundup && trackingReference.includes(":pending:")) {
          await db.update(articles).set({ carouselSlides }).where(eq(articles.id, article.id));
        }
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
      .where(and(inArray(articles.id, articleIds), or(eq(articles.status, "processing"), eq(articles.status, "ready"))));
    logStage("failed");
    console.error(`[pipeline] artikel ${article.id}:`, message);
    return { result: "failed", articleId: article.id, detail: message };
  }
}
