import { Buffer } from "node:buffer";
import { and, desc, eq, inArray } from "drizzle-orm";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles, quizEditions } from "@/lib/schema";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { renderQuizCard } from "@/lib/quiz-card";
import {
  buildQuizCaption,
  posterKey,
  quizAvailablePosters,
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
  type QuizReview,
} from "@/lib/quiz";
import { publishFacebookPagePost } from "@/lib/facebook";
import { MANUAL_REVIEW_SOURCE_NAME, manualImageReferer, parseManualReview, type ManualReviewItem } from "@/lib/manual-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cron calls GET once a day; the dashboard button calls POST to force an edition. */
export async function GET(request: NextRequest) {
  return handle(request, request.nextUrl.searchParams.get("force") === "1");
}

export async function POST(request: NextRequest) {
  return handle(request, true);
}

async function handle(request: NextRequest, forced: boolean) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  // Every past edition is read, because each poster may only appear in three quizzes.
  const editions = await db.select({
    id: quizEditions.id,
    posterKeys: quizEditions.posterKeys,
    postedAt: quizEditions.postedAt,
    createdAt: quizEditions.createdAt,
  }).from(quizEditions).orderBy(desc(quizEditions.createdAt));

  const lastPostedAt = editions.find((edition) => edition.postedAt)?.postedAt ?? null;
  const intervalDays = quizIntervalDays();

  // Two dashboard clicks in a row must not create two editions.
  const newest = editions[0];
  if (newest && !newest.postedAt && Date.now() - newest.createdAt.getTime() < 120_000) {
    return NextResponse.json({ ok: true, result: "busy", detail: "Edisi kuis sebelumnya masih diproses." });
  }

  if (!forced) {
    const state = shouldPostQuiz(new Date(), lastPostedAt, { intervalDays });
    if (!state.due) {
      return NextResponse.json({ ok: true, result: "not-due", detail: state.reason, schedule: QUIZ_SCHEDULE_LABEL });
    }
  }

  const reviews = await loadQuizReviews();
  const posters = quizPostersFromReviews(reviews);

  // Each poster may appear in at most three quizzes; the edition history marks the used ones.
  const usage = quizPosterUsage(editions);
  const available = quizAvailablePosters(posters, { usage, maxUses: QUIZ_MAX_USES });
  if (available.length < QUIZ_TILES) {
    const exhausted = posters.length - available.length;
    return NextResponse.json({
      error: `Butuh ${QUIZ_TILES} poster yang masih bisa dipakai, baru tersedia ${available.length}. ${exhausted > 0 ? `${exhausted} poster sudah mencapai batas ${QUIZ_MAX_USES}× kuis. ` : ""}Terbitkan review manual baru dulu (5 poster per review).`,
      posters: posters.length,
      available: available.length,
      maxUses: QUIZ_MAX_USES,
    }, { status: 409 });
  }

  const selected = selectQuizPosters(available, { count: QUIZ_TILES, usage, maxUses: QUIZ_MAX_USES });
  const reviewIds = [...new Set(selected.map((poster) => poster.reviewId))];

  const fetched = await Promise.all(selected.map(async (poster) => {
    const bytes = await fetchOgImageJpeg(poster.imageUrl, manualImageReferer(poster.imageUrl), fetch, (reason) => {
      console.warn(`[quiz] poster rejected (${poster.title}): ${reason}`);
    });
    return bytes ? { poster, bytes } : null;
  }));
  const tiles = fetched.filter((entry): entry is { poster: (typeof selected)[number]; bytes: Buffer } => entry !== null);
  if (tiles.length < QUIZ_TILES) {
    return NextResponse.json({
      error: `Hanya ${tiles.length} dari ${QUIZ_TILES} poster yang bisa diunduh. Periksa tautan gambar pada review manual, lalu coba lagi.`,
    }, { status: 502 });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN belum diatur; gambar kuis tidak bisa disimpan." }, { status: 503 });

  const caption = buildQuizCaption({ tiles: QUIZ_TILES });
  let grid: Buffer;
  try {
    grid = await renderQuizCard({
      tiles: tiles.map((tile) => tile.bytes),
      label: QUIZ_LABEL,
      sublabel: QUIZ_SUBLABEL,
      brand: process.env.PAGE_BRAND_ENTERTAINMENT?.trim() || "Popbeez",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyusun gambar kuis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const [edition] = await db.insert(quizEditions).values({
    posterKeys: tiles.map((tile) => posterKey(tile.poster.imageUrl)),
    reviewIds,
    caption,
  }).returning({ id: quizEditions.id });
  if (!edition) return NextResponse.json({ error: "Gagal menyimpan edisi kuis." }, { status: 500 });

  const blob = await put(`quiz/${edition.id}.jpg`, grid, {
    access: "public",
    addRandomSuffix: false,
    contentType: "image/jpeg",
    token,
  });

  try {
    const post = await publishFacebookPagePost({
      pageKey: "entertainment",
      imageUrls: [blob.url],
      caption,
    });
    await db.update(quizEditions).set({
      imageUrl: blob.url,
      facebookPostId: post.postId,
      postedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    }).where(eq(quizEditions.id, edition.id));
    console.info(`[quiz] posted edition=${edition.id} post=${post.postId}`);
    return NextResponse.json({
      ok: true,
      result: "posted",
      editionId: edition.id,
      postId: post.postId,
      imageUrl: blob.url,
      titles: tiles.map((tile) => tile.poster.title),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memposting kuis ke Facebook.";
    await db.update(quizEditions).set({
      imageUrl: blob.url,
      errorMessage: message.slice(0, 1_000),
      updatedAt: new Date(),
    }).where(eq(quizEditions.id, edition.id));
    console.error(`[quiz] post failed edition=${edition.id}: ${message}`);
    return NextResponse.json({ ok: false, error: message, editionId: edition.id, imageUrl: blob.url }, { status: 502 });
  }
}

/** Newest manual reviews first; each review contributes up to five posters (pool for many editions). */
async function loadQuizReviews(): Promise<QuizReview[]> {
  const rows = await getDb().select({ id: articles.id, rawText: articles.rawText, createdAt: articles.createdAt })
    .from(articles)
    .where(and(
      eq(articles.sourceName, MANUAL_REVIEW_SOURCE_NAME),
      inArray(articles.status, ["ready", "published"]),
    ))
    .orderBy(desc(articles.createdAt))
    .limit(24);

  const reviews: QuizReview[] = [];
  for (const row of rows) {
    const review = parseManualReview(row.rawText);
    if (!review) continue;
    reviews.push({
      id: row.id,
      createdAt: row.createdAt,
      items: review.items.map((item: ManualReviewItem) => ({ title: item.title, imageUrl: item.imageUrl })),
    });
  }
  return reviews;
}
