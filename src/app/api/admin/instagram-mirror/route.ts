import { and, desc, eq, isNull, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles, reels } from "@/lib/schema";
import { isInstagramPublishingEnabled, publishInstagramPost, publishInstagramReel } from "@/lib/instagram";
import { instagramCaption, mirrorEligibility, mirrorImageUrls, mirrorSlideCount } from "@/lib/instagram-mirror";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function publicAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) throw new Error("APP_URL belum diatur ke URL publik deployment Vercel.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL harus memakai HTTPS untuk deployment publik.");
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Re-mirrors posts that are already live on Facebook to Instagram, without touching
 * Facebook. Used after fixing the token / the 9007 container handling, so old posts
 * do not have to be resent.
 *
 * POST /api/admin/instagram-mirror
 *   { "id": "<article-uuid>", "force": false }      → one article
 *   { "reelId": "<reel-uuid>" }                     → one Reel video
 *   { "limit": 3, "force": false }                  → the newest eligible articles
 *
 * GET with the same query parameters works too (`?id=...&limit=...&force=1`).
 */
type MirrorOutcome = {
  id: string;
  title: string;
  ok: boolean;
  mediaId?: string;
  waitedMs?: number;
  detail?: string;
};

async function mirrorOne(
  article: {
    id: string;
    title: string;
    status: string;
    pageKey: string;
    sourceName: string;
    postFormat: string;
    caption: string | null;
    facebookPostId: string | null;
    instagramMediaId: string | null;
  },
  options: { force?: boolean; appUrl: string },
): Promise<MirrorOutcome> {
  const eligibility = mirrorEligibility(article, { force: options.force });
  if (!eligibility.ok) return { id: article.id, title: article.title, ok: false, detail: eligibility.reason };

  const caption = instagramCaption(article.caption);
  if (!caption) return { id: article.id, title: article.title, ok: false, detail: "Caption kosong; tidak ada yang bisa diposting." };

  try {
    const imageUrls = mirrorImageUrls(article, options.appUrl);
    const published = await publishInstagramPost({ imageUrls, caption });
    await getDb()
      .update(articles)
      .set({ instagramMediaId: published.mediaId, updatedAt: new Date() })
      .where(eq(articles.id, article.id));
    return {
      id: article.id,
      title: article.title,
      ok: true,
      mediaId: published.mediaId,
      waitedMs: published.waitedMs,
      detail: `${mirrorSlideCount(article)} gambar dikirim ke Instagram.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Instagram gagal.";
    console.error(`[instagram-mirror] gagal article=${article.id}: ${detail}`);
    await getDb()
      .update(articles)
      .set({ errorMessage: `Mirror Instagram gagal: ${detail}`.slice(0, 1_000), updatedAt: new Date() })
      .where(eq(articles.id, article.id))
      .catch(() => undefined);
    return { id: article.id, title: article.title, ok: false, detail };
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isInstagramPublishingEnabled()) {
    return NextResponse.json({ ok: false, error: "Instagram belum diatur: isi IG_USER_ID dan IG_ACCESS_TOKEN." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { id?: string; reelId?: string; limit?: number; force?: boolean };
  const force = body.force === true;
  let appUrl: string;
  try {
    appUrl = publicAppUrl();
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "APP_URL tidak valid." }, { status: 400 });
  }

  // One Reel: only the video URL is needed, the MP4 already lives in Blob.
  if (body.reelId) {
    const [reel] = await getDb()
      .select({ id: reels.id, videoUrl: reels.videoUrl, articleId: reels.articleId })
      .from(reels)
      .where(eq(reels.id, body.reelId))
      .limit(1);
    if (!reel) return NextResponse.json({ ok: false, error: "Reel tidak ditemukan." }, { status: 404 });
    if (!reel.videoUrl) {
      return NextResponse.json({ ok: false, error: "Reel ini tidak punya video publik (BLOB_READ_WRITE_TOKEN belum aktif saat render)." }, { status: 400 });
    }
    const [article] = await getDb()
      .select({ caption: articles.caption, title: articles.title })
      .from(articles)
      .where(eq(articles.id, reel.articleId))
      .limit(1);
    try {
      const published = await publishInstagramReel({ videoUrl: reel.videoUrl, caption: instagramCaption(article?.caption ?? article?.title ?? "") });
      await getDb()
        .update(reels)
        .set({ instagramMediaId: published.mediaId, errorMessage: null })
        .where(eq(reels.id, reel.id))
        .catch(() => undefined);
      return NextResponse.json({ ok: true, result: "reel", reelId: reel.id, mediaId: published.mediaId, waitedMs: published.waitedMs });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Instagram gagal.";
      return NextResponse.json({ ok: false, error: detail }, { status: 502 });
    }
  }

  const baseSelect = {
    id: articles.id,
    title: articles.title,
    status: articles.status,
    pageKey: articles.pageKey,
    sourceName: articles.sourceName,
    postFormat: articles.postFormat,
    caption: articles.caption,
    facebookPostId: articles.facebookPostId,
  };

  if (body.id) {
    const [article] = await getDb()
      .select({ ...baseSelect, instagramMediaId: articles.instagramMediaId })
      .from(articles)
      .where(eq(articles.id, body.id))
      .limit(1)
      .catch(async () => {
        // Migration 0013 not applied yet: mirror anyway, just without the saved ID.
        const [row] = await getDb().select(baseSelect).from(articles).where(eq(articles.id, body.id!)).limit(1);
        return row ? [{ ...row, instagramMediaId: null }] : [];
      });
    if (!article) return NextResponse.json({ ok: false, error: "Artikel tidak ditemukan." }, { status: 404 });
    const outcome = await mirrorOne(article, { force, appUrl });
    return NextResponse.json({ ok: outcome.ok, results: [outcome] }, { status: outcome.ok ? 200 : 502 });
  }

  const requestedLimit = Number.isFinite(body.limit) ? Number(body.limit) : 3;
  const limit = Math.min(Math.max(requestedLimit, 1), 10);

  type MirrorCandidate = {
    id: string;
    title: string;
    status: string;
    pageKey: string;
    sourceName: string;
    postFormat: string;
    caption: string | null;
    facebookPostId: string | null;
    instagramMediaId: string | null;
  };
  let candidates: MirrorCandidate[] = [];
  try {
    candidates = await getDb()
      .select({ ...baseSelect, instagramMediaId: articles.instagramMediaId })
      .from(articles)
      .where(and(
        eq(articles.status, "published"),
        force ? undefined : or(isNull(articles.instagramMediaId), eq(articles.instagramMediaId, "")),
      ))
      .orderBy(desc(articles.publishedAt))
      .limit(limit);
  } catch {
    const rows = await getDb()
      .select(baseSelect)
      .from(articles)
      .where(eq(articles.status, "published"))
      .orderBy(desc(articles.publishedAt))
      .limit(limit);
    candidates = rows.map((row) => ({ ...row, instagramMediaId: null }));
  }

  if (!candidates.length) {
    return NextResponse.json({ ok: true, results: [], detail: "Tidak ada post terbit yang perlu dicerminkan." });
  }

  const results: MirrorOutcome[] = [];
  for (const article of candidates) {
    results.push(await mirrorOne(article, { force, appUrl }));
  }
  const mirrored = results.filter((result) => result.ok).length;
  return NextResponse.json({
    ok: mirrored > 0,
    mirrored,
    failed: results.length - mirrored,
    results,
    detail: `${mirrored} post dicerminkan ke Instagram${results.length - mirrored ? `, ${results.length - mirrored} gagal (lihat detail)` : ""}.`,
  });
}

export async function GET(request: NextRequest) {
  // Same contract as POST so it can be triggered from a browser or curl.
  const params = request.nextUrl.searchParams;
  const body = {
    id: params.get("id") ?? undefined,
    reelId: params.get("reelId") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    force: params.get("force") === "1" || params.get("force") === "true",
  };
  const proxied = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });
  return POST(proxied);
}
