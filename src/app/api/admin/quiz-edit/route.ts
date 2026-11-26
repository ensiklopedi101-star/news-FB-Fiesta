import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { quizEditions } from "@/lib/schema";
import { loadQuizReviews } from "@/lib/quiz-reviews";
import { quizAvailablePosters, quizPosterUsage, quizPostersFromReviews, QUIZ_LABEL, QUIZ_SUBLABEL } from "@/lib/quiz";
import { quizDifficulties, isCurrentQuizDraft, quizEditsSchema, validateQuizSelection, type QuizSource } from "@/lib/quiz-customization";
import { fetchOgImageJpeg } from "@/lib/og-image";
import { manualImageReferer } from "@/lib/manual-review";
import { renderQuizCard } from "@/lib/quiz-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;
async function candidates(id: string, current: QuizSource[]) {
  const history = await getDb().select({ posterKeys: quizEditions.posterKeys }).from(quizEditions)
    .where(and(ne(quizEditions.id, id), inArray(quizEditions.status, ["published", "draft", "editing", "publishing"])));
  const pool = quizAvailablePosters(quizPostersFromReviews(await loadQuizReviews()), { usage: quizPosterUsage(history) });
  // Preserve currently selected, trusted sources even if their review left the recent pool.
  return [...current, ...pool.filter(p => !current.some(c => c.imageUrl === p.imageUrl))].map(p => ({ title: p.title, imageUrl: p.imageUrl, reviewId: p.reviewId }));
}
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "ID tidak valid." }, { status: 400 });
  try {
    const [edition] = await getDb().select().from(quizEditions).where(eq(quizEditions.id, id));
    if (!edition || edition.status !== "draft" || edition.posterSources.length !== 5) return NextResponse.json({ error: "Hanya preview draf dengan lima sumber yang bisa diubah." }, { status: 409 });
    return NextResponse.json({ previewUrl: edition.imageUrl, sources: edition.posterSources,
      difficulties: quizDifficulties(edition.difficulties), candidates: await candidates(id, edition.posterSources) });
  } catch {
    return NextResponse.json({ error: "Gagal memuat editor. Periksa database dan migrasi 0021_quiz_difficulty.sql." }, { status: 503 });
  }
}
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = quizEditsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pilih lima poster dan tingkat kesulitan yang valid." }, { status: 400 });
  const { editionId: id, previewUrl, tiles } = parsed.data;
  const db = getDb();
  try {
    const [edition] = await db.select().from(quizEditions).where(eq(quizEditions.id, id));
    if (!edition || !isCurrentQuizDraft(edition, previewUrl) || edition.posterSources.length !== 5) return NextResponse.json({ error: "Preview berubah atau terkunci. Muat ulang dashboard." }, { status: 409 });
    let sources;
    try { sources = validateQuizSelection(tiles, await candidates(id, edition.posterSources)); }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Pilihan tidak valid." }, { status: 400 }); }
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
    if (!token) return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN belum diatur." }, { status: 503 });
    const [claimed] = await db.update(quizEditions).set({ status: "editing", approvedAt: null, updatedAt: new Date() })
      .where(and(eq(quizEditions.id, id), eq(quizEditions.status, "draft"), eq(quizEditions.imageUrl, previewUrl))).returning({ id: quizEditions.id });
    if (!claimed) return NextResponse.json({ error: "Preview sedang diproses." }, { status: 409 });
    try {
      const bytes = [];
      for (const source of sources) {
        const image = await fetchOgImageJpeg(source.imageUrl, manualImageReferer(source.imageUrl));
        if (!image) throw new Error(`Gambar ${source.title} tidak dapat diunduh. Preview lama tetap disimpan.`);
        bytes.push(image);
      }
      const difficulties = tiles.map(t => t.difficulty);
      const grid = await renderQuizCard({ tiles: bytes, difficulties, label: QUIZ_LABEL, sublabel: QUIZ_SUBLABEL,
        brand: process.env.PAGE_BRAND_ENTERTAINMENT?.trim() || "PopBeez" });
      // Never overwrite an approved/reviewed URL: it also acts as the preview revision token.
      const blob = await put(`quiz/${id}-${randomUUID()}.jpg`, grid, { access: "public", addRandomSuffix: false, contentType: "image/jpeg", token });
      await db.update(quizEditions).set({ status: "draft", imageUrl: blob.url, posterSources: sources, posterKeys: sources.map(s => s.imageUrl),
        reviewIds: [...new Set(sources.map(s => s.reviewId))], difficulties, approvedAt: null, errorMessage: null, updatedAt: new Date() })
        .where(and(eq(quizEditions.id, id), eq(quizEditions.status, "editing"), eq(quizEditions.imageUrl, previewUrl)));
      return NextResponse.json({ ok: true, imageUrl: blob.url });
    } catch (e) {
      await db.update(quizEditions).set({ status: "draft", errorMessage: e instanceof Error ? e.message.slice(0, 1000) : "Render gagal.", updatedAt: new Date() })
        .where(and(eq(quizEditions.id, id), eq(quizEditions.status, "editing"), eq(quizEditions.imageUrl, previewUrl)));
      throw e;
    }
  } catch (e) {
    console.error("[quiz-edit]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Gagal membuat preview baru." }, { status: 500 });
  }
}
