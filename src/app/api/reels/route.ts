import { and, desc, eq, isNotNull } from "drizzle-orm";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles, reels } from "@/lib/schema";
import { AUDIENCE_NAME, entertainmentBrand } from "@/lib/brand";
import { buildReelScenes, totalSeconds, buildReelCaption } from "@/lib/reel-script";
import { renderReelFrame, REEL_HEIGHT, REEL_WIDTH } from "@/lib/reel-frames";
import { synthesizeNarration, TtsUnavailableError } from "@/lib/reel-tts";
import { ReelEncoderMissingError, renderReelLocally, renderReelRemotely, type ReelSlide } from "@/lib/reel-video";
import { publishFacebookReel } from "@/lib/reel-facebook";
import { isInstagramPublishingEnabled, publishInstagramReel } from "@/lib/instagram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// TTS + frame rendering + encoding + upload; the encoder may live on a VPS.
export const maxDuration = 300;

const REELS_HANDLE = "@portalbeez";

function reelsEnabled(): boolean {
  return process.env.REELS_ENABLED?.trim() === "1";
}

/** Reels are a bonus, not the backbone: at most one per `REELS_MIN_GAP_HOURS`. */
function minimumGapHours(): number {
  const configured = Number(process.env.REELS_MIN_GAP_HOURS?.trim());
  return Number.isFinite(configured) && configured >= 0 ? configured : 20;
}

/** Cron calls GET once per hour; the dashboard button calls POST to force one now. */
export async function GET(request: NextRequest) {
  return handle(request, false);
}

export async function POST(request: NextRequest) {
  return handle(request, true);
}

async function handle(request: NextRequest, force: boolean) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!reelsEnabled() && !force) {
    return NextResponse.json({ result: "disabled", detail: "REELS_ENABLED belum diatur ke 1." });
  }

  const db = getDb();
  const now = new Date();
  const gapMs = minimumGapHours() * 60 * 60 * 1000;

  if (!force) {
    const [latest] = await db.select({ createdAt: reels.createdAt })
      .from(reels)
      .where(eq(reels.status, "published"))
      .orderBy(desc(reels.createdAt))
      .limit(1);
    if (latest && now.getTime() - latest.createdAt.getTime() < gapMs) {
      return NextResponse.json({ result: "idle", detail: `Reel terakhir belum berumur ${minimumGapHours()} jam.` });
    }
  }

  // Narration comes from the entertainment pipeline (PopBeez), newest first.
  const [candidate] = await db.select({
    id: articles.id,
    title: articles.title,
    narration: articles.narrationScript,
    question: articles.caption,
    sourceName: articles.sourceName,
    hashtags: articles.caption,
  }).from(articles)
    .where(and(
      eq(articles.pageKey, "entertainment"),
      eq(articles.status, "published"),
      isNotNull(articles.narrationScript),
    ))
    .orderBy(desc(articles.publishedAt))
    .limit(1);

  if (!candidate?.narration) {
    return NextResponse.json({ result: "idle", detail: "Belum ada artikel terbit dengan naskah narasi." });
  }

  const [existing] = await db.select({ id: reels.id, status: reels.status })
    .from(reels).where(eq(reels.articleId, candidate.id)).limit(1);
  if (existing?.status === "published") {
    return NextResponse.json({ result: "idle", detail: "Artikel terbaru sudah punya Reel." });
  }

  // The frame tag invites the audience; the editorial tone stays internal.
  const voiceLabel = AUDIENCE_NAME;
  const scenes = buildReelScenes(candidate.narration);
  if (scenes.length < 2) {
    return NextResponse.json({ result: "idle", detail: "Naskah narasi terlalu pendek untuk dijadikan Reel." });
  }

  const reelId = existing?.id ?? (await db.insert(reels).values({
    articleId: candidate.id,
    narration: candidate.narration,
    voiceLabel,
    frameCount: scenes.length,
    durationSeconds: Math.round(totalSeconds(scenes)),
  }).returning({ id: reels.id }))[0]?.id;
  if (!reelId) return NextResponse.json({ error: "Gagal menyimpan catatan Reel." }, { status: 500 });

  const fail = async (message: string) => {
    await db.update(reels)
      .set({ status: "failed", errorMessage: message.slice(0, 1_000), updatedAt: new Date() })
      .where(eq(reels.id, reelId));
    return NextResponse.json({ result: "failed", detail: message });
  };

  try {
    await db.update(reels).set({ status: "rendering", errorMessage: null, updatedAt: new Date() }).where(eq(reels.id, reelId));

    const frames = await Promise.all(scenes.map((scene, index) => renderReelFrame(scene, {
      brand: entertainmentBrand(),
      handle: REELS_HANDLE,
      voiceLabel,
      sourceName: candidate.sourceName,
    }, index)));

    const audio = await synthesizeNarration(candidate.narration, { timeoutMs: 30_000 });

    const slides: ReelSlide[] = frames.map((png, index) => ({ png, seconds: scenes[index]!.seconds }));
    const renderEndpoint = process.env.REELS_RENDER_URL?.trim();
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

    let video: Buffer;
    if (renderEndpoint) {
      if (!blobToken) throw new ReelEncoderMissingError("REELS_RENDER_URL butuh BLOB_READ_WRITE_TOKEN agar frame bisa diunduh worker.");
      const frameUrls = await Promise.all(frames.map(async (png, index) =>
        (await put(`reels/${reelId}/frame-${index}.png`, png, {
          access: "public", addRandomSuffix: false, contentType: "image/png", token: blobToken,
        })).url));
      video = await renderReelRemotely({
        endpoint: renderEndpoint,
        token: process.env.REELS_WORKER_TOKEN?.trim(),
        frameUrls,
        scenes,
        audio: audio.audio,
      });
    } else {
      video = await renderReelLocally(slides, audio.audio);
    }

    let videoUrl: string | null = null;
    if (blobToken) {
      videoUrl = (await put(`reels/${reelId}.mp4`, video, {
        access: "public", addRandomSuffix: false, contentType: "video/mp4", token: blobToken,
      })).url;
    }

    const caption = buildReelCaption({
      headline: candidate.title,
      question: firstQuestion(candidate.question) ?? "Menurut kamu, bagaimana?",
      sourceName: candidate.sourceName,
    });
    const published = await publishFacebookReel({ pageKey: "entertainment", video, description: caption });

    await db.update(reels)
      .set({
        status: "published",
        videoUrl,
        facebookVideoId: published.videoId,
        durationSeconds: Math.round(totalSeconds(scenes)),
        frameCount: scenes.length,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(reels.id, reelId));

    // Instagram Reels needs a public video URL; without Blob storage we skip it cleanly.
    let instagramMediaId: string | null = null;
    let instagramNote: string | null = null;
    if (isInstagramPublishingEnabled() && videoUrl) {
      try {
        instagramMediaId = (await publishInstagramReel({ videoUrl, caption })).mediaId;
        console.info(`[reels] instagram reel=${instagramMediaId} article=${candidate.id}`);
      } catch (instagramError) {
        const detail = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
        instagramNote = `Reel Facebook terbit; Instagram gagal: ${detail}`.slice(0, 1_000);
        await db.update(reels).set({ errorMessage: instagramNote, updatedAt: new Date() }).where(eq(reels.id, reelId));
        console.warn(`[reels] instagram gagal article=${candidate.id}: ${detail.slice(0, 200)}`);
      }
    } else if (isInstagramPublishingEnabled()) {
      instagramNote = "Reel terbit di Facebook; Instagram butuh video publik (BLOB_READ_WRITE_TOKEN).";
    }

    console.info(`[reels] published article=${candidate.id} video=${published.videoId} frames=${scenes.length} bytes=${video.length}`);
    return NextResponse.json({
      result: "published",
      reelId,
      videoId: published.videoId,
      videoUrl,
      instagramMediaId,
      ...(instagramNote ? { instagramNote } : {}),
      frames: scenes.length,
      durationSeconds: Math.round(totalSeconds(scenes)),
      width: REEL_WIDTH,
      height: REEL_HEIGHT,
      title: candidate.title,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Render Reel gagal.";
    const prefix = error instanceof TtsUnavailableError
      ? "Narasi suara gagal (Edge TTS): "
      : error instanceof ReelEncoderMissingError
        ? "Encoder video tidak tersedia: "
        : "";
    console.warn(`[reels] failed article=${candidate.id} reason=${detail.slice(0, 200)}`);
    return fail(`${prefix}${detail}`);
  }
}

/** The caption keeps the discussion question; pull it out of the published caption. */
function firstQuestion(caption: string | null): string | null {
  if (!caption) return null;
  return caption.split("\n").map((line) => line.trim()).find((line) => line.endsWith("?")) ?? null;
}
