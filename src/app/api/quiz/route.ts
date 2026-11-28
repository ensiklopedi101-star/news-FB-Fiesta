import { quizDifficulties, isCurrentQuizDraft } from "@/lib/quiz-customization";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { quizEditions } from "@/lib/schema";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderQuizCard } from "@/lib/quiz-card";
import {
  buildQuizCaption,
  posterKey,
  quizAnswerKey,
  quizAvailablePosters,
  quizEditionNeedsOutcomeReview,
  quizIntervalDays,
  quizPosterUsage,
  QUIZ_LABEL,
  QUIZ_MAX_USES,
  QUIZ_SCHEDULE_LABEL,
  QUIZ_SUBLABEL,
  QUIZ_TILES,
  quizPostersFromReviews,
  selectQuizPosters,
  shouldPostQuiz,
  type QuizAnswer,
  type QuizPoster,
  type QuizReview,
} from "@/lib/quiz";
import { publishFacebookPagePost, FacebookPublishOutcomeUnknownError } from "@/lib/facebook";
import { isInstagramPublishingEnabled, publishInstagramPost } from "@/lib/instagram";
import { MANUAL_REVIEW_SOURCE_NAMES, manualImageReferer, parseManualReview, type ManualReviewItem } from "@/lib/manual-review";
import { claimEditorialDraft, finishEditorialDraft, saveEditorialDraft } from "@/lib/editorial-drafts";
import { previewDataUrls } from "@/lib/editorial-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Image fetch + card render + Facebook Graph upload.
export const maxDuration = 300;

const quizEditionStatus = "posted";

type QuizDraftPayload = {
  posterKeys: string[];
  reviewIds: string[];
  answerKey: QuizAnswer[];
  caption: string;
  imageUrl: string;
  titles: string[];
};

type PreparedQuiz = {
  payload: QuizDraftPayload;
  preview: Buffer;
};

/** Cron calls GET once a day; manual dashboard publication uses an explicitly previewed draft. */
export async function GET(request: NextRequest) {
  return handleScheduled(request, request.nextUrl.searchParams.get("force") === "1");
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }
  const action = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { action?: unknown }).action
    : null;
  if (action === "preview") return createPreview();
  if (action === "publish") {
    const draftId = (body as { draftId?: unknown }).draftId;
    if (typeof draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(draftId)) {
      return NextResponse.json({ error: "ID pratinjau kuis tidak valid." }, { status: 400 });
    }
    return publishPreview(draftId);
  }
  return NextResponse.json({ error: "Pilih action preview atau publish. Kuis manual tidak diterbitkan tanpa konfirmasi pratinjau." }, { status: 400 });
}

async function createPreview() {
  const draftId = randomUUID();
  try {
    const prepared = await prepareQuiz(draftId);
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!blobToken) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN belum diatur; pratinjau tidak bisa disimpan." }, { status: 503 });
    const blob = await put(`quiz/${draftId}.jpg`, prepared.preview, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/jpeg",
      token: blobToken,
    });
    prepared.payload.imageUrl = blob.url;
    const draft = await saveEditorialDraft({
      id: draftId,
      kind: "tebak_drama",
      payload: prepared.payload,
    });
    return NextResponse.json({
      ok: true,
      result: "previewed",
      draftId: draft.id,
      imageUrl: blob.url,
      previewImage: previewDataUrls([prepared.preview])[0],
      titles: prepared.payload.titles,
      expiresAt: draft.expiresAt.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyusun pratinjau kuis.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function publishPreview(draftId: string) {
  let draft;
  try {
    draft = await claimEditorialDraft(draftId, "tebak_drama");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draf kuis tidak dapat dibuka." }, { status: 503 });
  }
  if (!draft) return NextResponse.json({ error: "Pratinjau sudah digunakan atau kedaluwarsa. Buat pratinjau baru." }, { status: 409 });
  const payload = parseQuizDraftPayload(draft.payload);
  if (!payload) {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: "Data pratinjau kuis tidak valid." });
    return NextResponse.json({ error: "Data pratinjau kuis tidak valid." }, { status: 409 });
  }

  const usageConflict = await quizUsageConflict(payload.posterKeys);
  if (usageConflict) {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: usageConflict });
    return NextResponse.json({ error: `${usageConflict} Buat pratinjau baru.` }, { status: 409 });
  }

  const result = await publishQuizEdition(payload, draftId);
  let trackingDetail = result.ok ? result.detail : undefined;
  try {
    await finishEditorialDraft({
      id: draftId,
      status: result.ok ? "published" : result.unknown ? "outcome_unknown" : "failed",
      resultId: result.editionId,
      errorMessage: result.ok ? trackingDetail ?? null : result.error,
    });
  } catch (error) {
    const note = result.ok
      ? `Facebook mengonfirmasi kuis, tetapi status draf belum tersimpan: ${error instanceof Error ? error.message : String(error)}. Jangan kirim ulang; periksa halaman Facebook.`
      : `Status draf tidak berhasil disimpan: ${error instanceof Error ? error.message : String(error)}.`;
    trackingDetail = [trackingDetail, note].filter(Boolean).join(" ").slice(0, 1_000);
    console.error(`[quiz] editorial draft update failed edition=${result.editionId}:`, error instanceof Error ? error.message : error);
  }
  return result.ok
    ? NextResponse.json({
        ok: true,
        result: "posted",
        editionId: result.editionId,
        postId: result.postId,
        imageUrl: result.imageUrl,
        titles: payload.titles,
        ...(trackingDetail ? { detail: trackingDetail } : {}),
      })
    : NextResponse.json({
        ok: false,
        error: result.error,
        editionId: result.editionId,
        imageUrl: result.imageUrl,
        ...(trackingDetail ? { detail: trackingDetail } : {}),
        ...(result.unknown ? { outcomeUnknown: true } : {}),
      }, { status: result.unknown ? 202 : 502 });
}

async function handleScheduled(request: NextRequest, forced: boolean) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  const editions = await db.select({
    id: quizEditions.id,
    status: quizEditions.status,
    posterKeys: quizEditions.posterKeys,
    facebookPostId: quizEditions.facebookPostId,
    errorMessage: quizEditions.errorMessage,
    postedAt: quizEditions.postedAt,
    createdAt: quizEditions.createdAt,
  }).from(quizEditions).orderBy(desc(quizEditions.createdAt));
  const lastPostedAt = editions.find((edition) => edition.postedAt)?.postedAt ?? null;
  const intervalDays = quizIntervalDays();

  // Manual preview drafts live separately and never reserve a quiz poster or block the scheduled run.
  const newest = editions[0];
  if (newest && quizEditionNeedsOutcomeReview(newest)) {
    return NextResponse.json({
      ok: false,
      result: "outcome-unknown",
      editionId: newest.id,
      error: newest.errorMessage ?? "Facebook mengembalikan ID tetapi status edisi belum tercatat; periksa halaman Facebook sebelum menerbitkan kuis lagi.",
      outcomeUnknown: true,
    }, { status: 202 });
  }
  if (newest && !newest.postedAt && Date.now() - newest.createdAt.getTime() < 120_000) {
    return NextResponse.json({ ok: true, result: "busy", detail: "Edisi kuis sebelumnya masih diproses." });
  }
  if (!forced) {
    const state = shouldPostQuiz(new Date(), lastPostedAt, { intervalDays });
    if (!state.due) {
      return NextResponse.json({ ok: true, result: "not-due", detail: state.reason, schedule: QUIZ_SCHEDULE_LABEL });
    }
  }

  const editionId = randomUUID();
  try {
    const prepared = await prepareQuiz(editionId, editions);
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!blobToken) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN belum diatur; gambar kuis tidak bisa disimpan." }, { status: 503 });
    const blob = await put(`quiz/${editionId}.jpg`, prepared.preview, {
      access: "public",
      addRandomSuffix: false,
      contentType: "image/jpeg",
      token: blobToken,
    });
    prepared.payload.imageUrl = blob.url;
    const result = await publishQuizEdition(prepared.payload, editionId);
    return result.ok
      ? NextResponse.json({
          ok: true,
          result: quizEditionStatus,
          editionId: result.editionId,
          postId: result.postId,
          imageUrl: result.imageUrl,
          titles: prepared.payload.titles,
          ...(result.detail ? { detail: result.detail } : {}),
        })
      : NextResponse.json({
          ok: false,
          error: result.error,
          editionId: result.editionId,
          imageUrl: result.imageUrl,
          ...(result.unknown ? { outcomeUnknown: true } : {}),
        }, { status: result.unknown ? 202 : 502 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal membuat pratinjau kuis.";
    console.error(`[quiz] preparation failed edition=${editionId}: ${message}`);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function prepareQuiz(editionId: string, existingEditions?: Array<{ posterKeys: string[] | null }>): Promise<PreparedQuiz> {
  const editions = existingEditions ?? await getDb().select({ posterKeys: quizEditions.posterKeys })
    .from(quizEditions).orderBy(desc(quizEditions.createdAt));
  const reviews = await loadQuizReviews();
  const posters = quizPostersFromReviews(reviews);
  const usage = quizPosterUsage(editions);
  const available = quizAvailablePosters(posters, { usage, maxUses: QUIZ_MAX_USES });
  if (available.length < QUIZ_TILES) {
    const exhausted = posters.length - available.length;
    throw new Error(`Butuh ${QUIZ_TILES} poster yang masih bisa dipakai, baru tersedia ${available.length}. ${exhausted > 0 ? `${exhausted} poster sudah mencapai batas ${QUIZ_MAX_USES}× kuis. ` : ""}Terbitkan review manual baru dulu (5 poster per review).`);
  }

  const selected = selectQuizPosters(available, { count: QUIZ_TILES, usage, maxUses: QUIZ_MAX_USES });
  const fetched = await Promise.all(selected.map(async (poster) => {
    const bytes = await fetchOgImageJpeg(poster.imageUrl, manualImageReferer(poster.imageUrl), fetch, (reason) => {
      console.warn(`[quiz] poster rejected (${poster.title}): ${reason}`);
    });
    return bytes ? { poster, bytes } : null;
  }));
  const tiles = fetched.filter((entry): entry is { poster: QuizPoster; bytes: Buffer } => entry !== null);
  if (tiles.length < QUIZ_TILES) {
    throw new Error(`Hanya ${tiles.length} dari ${QUIZ_TILES} poster yang bisa diunduh. Periksa tautan gambar pada review manual, lalu coba lagi.`);
  }

  const grid = await renderQuizCard({
    tiles: tiles.map((tile) => tile.bytes),
    label: QUIZ_LABEL,
    sublabel: QUIZ_SUBLABEL,
    brand: process.env.PAGE_BRAND_ENTERTAINMENT?.trim() || "PopBeez",
  });
  const selectedPosters = tiles.map((tile) => tile.poster);
  return {
    preview: grid,
    payload: {
      posterKeys: selectedPosters.map((poster) => posterKey(poster.imageUrl)),
      reviewIds: [...new Set(selectedPosters.map((poster) => poster.reviewId))],
      answerKey: quizAnswerKey(selectedPosters),
      caption: buildQuizCaption(),
      imageUrl: "",
      titles: selectedPosters.map((poster) => poster.title),
    },
  };
}

function parseQuizDraftPayload(value: Record<string, unknown>): QuizDraftPayload | null {
  if (!Array.isArray(value.posterKeys) || value.posterKeys.length !== QUIZ_TILES
    || value.posterKeys.some((item) => typeof item !== "string")
    || !Array.isArray(value.reviewIds) || value.reviewIds.some((item) => typeof item !== "string")
    || !Array.isArray(value.answerKey) || value.answerKey.length !== QUIZ_TILES
    || !Array.isArray(value.titles) || value.titles.length !== QUIZ_TILES
    || typeof value.caption !== "string" || typeof value.imageUrl !== "string" || !/^https:\/\//i.test(value.imageUrl)) return null;
  const answers = value.answerKey as unknown[];
  if (answers.some((answer) => !answer || typeof answer !== "object" || typeof (answer as { title?: unknown }).title !== "string" || typeof (answer as { reviewId?: unknown }).reviewId !== "string" || !((answer as { sourceUrl?: unknown }).sourceUrl === null || typeof (answer as { sourceUrl?: unknown }).sourceUrl === "string"))) return null;
  return value as unknown as QuizDraftPayload;
}

async function quizUsageConflict(posterKeys: string[]): Promise<string | null> {
  const editions = await getDb().select({ posterKeys: quizEditions.posterKeys }).from(quizEditions);
  const usage = quizPosterUsage(editions);
  return posterKeys.some((key) => (usage[key] ?? 0) >= QUIZ_MAX_USES)
    ? `Salah satu poster dalam pratinjau sudah mencapai batas ${QUIZ_MAX_USES} kali pemakaian.`
    : null;
}

async function publishQuizEdition(payload: QuizDraftPayload, editionId: string): Promise<
  | { ok: true; editionId: string; postId: string; imageUrl: string; detail?: string }
  | { ok: false; editionId: string; imageUrl: string; error: string; unknown: boolean }
> {
  const db = getDb();
  const now = new Date();
  await db.insert(quizEditions).values({
    id: editionId,
    posterKeys: payload.posterKeys,
    reviewIds: payload.reviewIds,
    answerKey: payload.answerKey,
    segment: "tebak_drama",
    contentFormat: "quiz_grid",
    pillar: "community",
    imageUrl: payload.imageUrl,
    caption: payload.caption,
    createdAt: now,
    updatedAt: now,
  });

  let acceptedPost: Awaited<ReturnType<typeof publishFacebookPagePost>> | null = null;
  try {
    const post = await publishFacebookPagePost({
      pageKey: "entertainment",
      imageUrls: [payload.imageUrl],
      caption: payload.caption,
    });
    acceptedPost = post;
    await db.update(quizEditions).set({
      facebookPostId: post.postId,
      postedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    }).where(eq(quizEditions.id, editionId));
    console.info(`[quiz] posted edition=${editionId} post=${post.postId}`);

    // Mirror the quiz to Instagram; a failure must not undo the Facebook post.
    if (isInstagramPublishingEnabled()) {
      try {
        await publishInstagramPost({ imageUrls: [payload.imageUrl], caption: payload.caption });
        console.info(`[quiz] instagram posted edition=${editionId}`);
      } catch (instagramError) {
        const detail = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
        await db.update(quizEditions).set({ errorMessage: `Kuis terbit di Facebook; Instagram gagal: ${detail}`.slice(0, 1_000) }).where(eq(quizEditions.id, editionId));
        console.warn(`[quiz] instagram gagal edition=${editionId}: ${detail.slice(0, 200)}`);
      }
    }
    return { ok: true, editionId, postId: post.postId, imageUrl: payload.imageUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memposting kuis ke Facebook.";
    if (acceptedPost) {
      const detail = `Facebook mengonfirmasi post ${acceptedPost.postId}, tetapi pencatatan lanjutan gagal: ${message.slice(0, 220)}. Jangan kirim ulang; periksa halaman Facebook terlebih dahulu.`;
      try {
        await db.update(quizEditions).set({
          facebookPostId: acceptedPost.postId,
          postedAt: new Date(),
          errorMessage: detail.slice(0, 1_000),
          updatedAt: new Date(),
        }).where(eq(quizEditions.id, editionId));
        console.warn(`[quiz] publication tracking recovered after follow-up failure edition=${editionId}`);
      } catch (trackingError) {
        console.error(`[quiz] Facebook confirmed but full tracking recovery failed edition=${editionId}:`, trackingError instanceof Error ? trackingError.message : trackingError);
        await db.update(quizEditions).set({
          facebookPostId: acceptedPost.postId,
          errorMessage: detail.slice(0, 1_000),
          updatedAt: new Date(),
        }).where(eq(quizEditions.id, editionId)).catch((fallbackError) => {
          console.error(`[quiz] Facebook confirmed but outcome marker recovery failed edition=${editionId}:`, fallbackError instanceof Error ? fallbackError.message : fallbackError);
        });
      }
      return { ok: true, editionId, postId: acceptedPost.postId, imageUrl: payload.imageUrl, detail };
    }

    const unknown = error instanceof FacebookPublishOutcomeUnknownError;
    await db.update(quizEditions).set({
      ...(unknown ? { facebookPostId: `facebook:outcome-unknown:${editionId}` } : {}),
      errorMessage: message.slice(0, 1_000),
      updatedAt: new Date(),
    }).where(eq(quizEditions.id, editionId)).catch((trackingError) => {
      console.error(`[quiz] failed to save publish error edition=${editionId}:`, trackingError instanceof Error ? trackingError.message : trackingError);
    });
    console.error(`[quiz] post failed edition=${editionId}: ${message}`);
    return {
      ok: false,
      editionId,
      imageUrl: payload.imageUrl,
      error: message,
      unknown,
    };
  }
}

/** Newest manual drama reviews first; film/music Top 5 posts are not quiz answer candidates. */
async function loadQuizReviews(): Promise<QuizReview[]> {
  const rows = await getDb().select({ id: articles.id, rawText: articles.rawText, createdAt: articles.createdAt })
    .from(articles)
    .where(and(
      inArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES]),
      inArray(articles.status, ["ready", "published"]),
    ))
    .orderBy(desc(articles.createdAt))
    .limit(24);

  const reviews: QuizReview[] = [];
  for (const row of rows) {
    const review = parseManualReview(row.rawText);
    if (!review || review.mediaType !== "DRAMA") continue;
    reviews.push({
      id: row.id,
      createdAt: row.createdAt,
      items: review.items.map((item: ManualReviewItem) => ({ title: item.title, imageUrl: item.imageUrl, sourceUrl: item.sourceUrl ?? null })),
    });
  }
  return reviews;
}
