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
import { isInstagramPublishingEnabled, publishInstagramPost } from "@/lib/instagram";
import { MANUAL_REVIEW_SOURCE_NAMES, manualImageReferer, parseManualReview, type ManualReviewItem } from "@/lib/manual-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Budget for downloading five posters and rendering the preview.
export const maxDuration = 300;

/** GET/POST create previews only. Publishing requires the explicit approve action. */
export async function GET(request: NextRequest) {
  return handle(request, request.nextUrl.searchParams.get("force") === "1");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "reject") {
    if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (typeof body.editionId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.editionId)) return NextResponse.json({ error: "ID tidak valid." }, { status: 400 });
    const rows = await getDb().update(quizEditions).set({ status: "rejected", updatedAt: new Date() })
      .where(and(eq(quizEditions.id, body.editionId), eq(quizEditions.status, "draft"))).returning({ id: quizEditions.id });
    return NextResponse.json({ ok: true, detail: rows.length ? "Preview ditolak. Silakan buat edisi baru." : "Edisi tidak dapat ditolak." });
  }
  if (body.action === "approve") return approveEdition(request, body.editionId);
  return handle(request, true);
}

async function handle(request: NextRequest, forced: boolean) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  // Every past edition is read, because each poster may only appear in three quizzes.
  const editions = await db.select({
    id: quizEditions.id,
    status: quizEditions.status,
    posterKeys: quizEditions.posterKeys,
    postedAt: quizEditions.postedAt,
    createdAt: quizEditions.createdAt,
  }).from(quizEditions).orderBy(desc(quizEditions.createdAt));

  const lastPostedAt = editions.find((edition) => edition.postedAt)?.postedAt ?? null;
  const intervalDays = quizIntervalDays();

  // Two dashboard clicks in a row must not create two editions.
  const [pending] = await db.select({ id: quizEditions.id }).from(quizEditions)
    .where(inArray(quizEditions.status, ["draft", "publishing"])).limit(1);
  if (pending) return NextResponse.json({ ok: true, result: "pending", detail: "Preview menunggu persetujuan atau publikasi sedang berjalan." });
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
  const usage = quizPosterUsage(editions.filter((edition) => edition.postedAt || ["draft", "publishing"].includes(edition.status)));
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

  const caption = buildQuizCaption();

  let grid: Buffer;
  try {
    grid = await renderQuizCard({
      tiles: tiles.map((tile) => tile.bytes),
      label: QUIZ_LABEL,
      sublabel: QUIZ_SUBLABEL,
      brand: process.env.PAGE_BRAND_ENTERTAINMENT?.trim() || "PopBeez",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyusun gambar kuis.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const [edition] = await db.insert(quizEditions).values({
    status: "generating",
    posterKeys: tiles.map((tile) => posterKey(tile.poster.imageUrl)),
    reviewIds,
    posterSources: tiles.map(({ poster }) => ({ title: poster.title, imageUrl: poster.imageUrl, reviewId: poster.reviewId })),
    caption,
  }).returning({ id: quizEditions.id });
  if (!edition) return NextResponse.json({ error: "Gagal menyimpan edisi kuis." }, { status: 500 });

  try {
    const blob = await put(`quiz/${edition.id}.jpg`, grid, {
      access: "public", addRandomSuffix: false, contentType: "image/jpeg", token,
    });
    await db.update(quizEditions).set({ status: "draft", imageUrl: blob.url, updatedAt: new Date() }).where(eq(quizEditions.id, edition.id));
    return NextResponse.json({ ok: true, result: "draft", editionId: edition.id, imageUrl: blob.url,
      detail: "Preview siap. Periksa kelima gambar sebelum menyetujui publikasi." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload preview gagal.";
    await db.update(quizEditions).set({ status: "failed", errorMessage: message.slice(0, 1000), updatedAt: new Date() })
      .where(eq(quizEditions.id, edition.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** The only publishing path: explicit human approval, with an atomic claim. */
async function approveEdition(request: NextRequest, id: unknown) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID tidak valid." }, { status: 400 });
  const db = getDb();
  const [edition] = await db.select().from(quizEditions).where(eq(quizEditions.id, id));
  if (!edition?.imageUrl || !edition.caption || edition.status !== "draft") {
    return NextResponse.json({ error: "Preview tidak siap atau sudah diproses." }, { status: 409 });
  }
  const [claimed] = await db.update(quizEditions).set({ status: "publishing", approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(quizEditions.id, id), eq(quizEditions.status, "draft"))).returning({ id: quizEditions.id });
  if (!claimed) return NextResponse.json({ error: "Edisi sedang diproses." }, { status: 409 });
  const blob = { url: edition.imageUrl };
  const caption = edition.caption;
  try {
    const post = await publishFacebookPagePost({
      pageKey: "entertainment",
      imageUrls: [blob.url],
      caption,
    });
    await db.update(quizEditions).set({
      status: "published",
      imageUrl: blob.url,
      facebookPostId: post.postId,
      postedAt: new Date(),
      updatedAt: new Date(),
      errorMessage: null,
    }).where(eq(quizEditions.id, edition.id));
    console.info(`[quiz] posted edition=${edition.id} post=${post.postId}`);

    // Mirror the quiz to Instagram; a failure must not undo the Facebook post.
    if (isInstagramPublishingEnabled()) {
      try {
        await publishInstagramPost({ imageUrls: [blob.url], caption });
        console.info(`[quiz] instagram posted edition=${edition.id}`);
      } catch (instagramError) {
        const detail = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
        await db.update(quizEditions).set({ errorMessage: `Kuis terbit di Facebook; Instagram gagal: ${detail}`.slice(0, 1_000) }).where(eq(quizEditions.id, edition.id));
        console.warn(`[quiz] instagram gagal edition=${edition.id}: ${detail.slice(0, 200)}`);
      }
    }
    return NextResponse.json({
      ok: true,
      result: "posted",
      editionId: edition.id,
      postId: post.postId,
      imageUrl: blob.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memposting kuis ke Facebook.";
    await db.update(quizEditions).set({
      imageUrl: blob.url,
      status: "failed",
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
      inArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES]),
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
