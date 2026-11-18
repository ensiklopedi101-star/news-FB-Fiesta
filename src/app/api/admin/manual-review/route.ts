import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { isAuthorized } from "@/lib/auth";
import { createManualReview, buildManualReviewCaption, manualImageReferer } from "@/lib/manual-review";
import { getPublishingPause } from "@/lib/pipeline";
import { enqueueBufferFacebookPost } from "@/lib/buffer";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { storeArticleImageInBlob } from "@/lib/blob-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }

  let review;
  try {
    review = createManualReview(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data review tidak valid." }, { status: 400 });
  }

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return NextResponse.json({ error: "APP_URL belum diatur." }, { status: 503 });
  let publicAppUrl: string;
  try {
    publicAppUrl = new URL(appUrl).toString().replace(/\/$/, "");
  } catch {
    return NextResponse.json({ error: "APP_URL tidak valid." }, { status: 503 });
  }

  const pause = await getPublishingPause();
  if (pause) return NextResponse.json({ error: pause.detail, nextAllowedAt: pause.nextAllowedAt }, { status: 429 });

  const id = randomUUID();
  const createdAt = new Date();
  const originalImages = review.items.map((item) => item.imageUrl);
  const storedImages = await Promise.all(originalImages.map(async (url, index) =>
    await storeArticleImageInBlob(`${id}-review-${index + 1}`, url, manualImageReferer(url)) ?? url));
  review.items = review.items.map((item, index) => ({ ...item, imageUrl: storedImages[index]! }));
  const title = review.headline;
  const caption = buildManualReviewCaption(review);
  const imageUrls = Array.from({ length: 6 }, (_, index) => `${publicAppUrl}/api/og/${id}?slide=${index + 1}`);

  try {
    const db = getDb();
    await db.insert(articles).values({
      id,
      sourceName: "Review manual Popbeez",
      category: review.mediaType,
      pageKey: "entertainment",
      sourceUrl: "https://www.facebook.com/portalbeez",
      urlHash: createHash("sha256").update(`manual-review:${id}`).digest("hex"),
      title,
      originalTitle: title,
      rawText: JSON.stringify(review),
      imageUrl: storedImages[0] ?? null,
      imageUrls: storedImages,
      caption,
      status: "processing",
      postFormat: "carousel",
      createdAt,
      updatedAt: createdAt,
    });

    const result = await enqueueBufferFacebookPost({
      pageKey: "entertainment",
      imageUrl: imageUrls[0]!,
      imageUrls,
      caption,
    });
    await db.update(articles).set({
      status: "ready",
      postFormat: result.mediaFormat,
      facebookPostId: `buffer:${result.postId}`,
      updatedAt: new Date(),
      errorMessage: result.mediaFormat === "single"
        ? "Buffer menolak carousel enam slide dan hanya menerima cover."
        : null,
    }).where(eq(articles.id, id));
    return NextResponse.json({ ok: true, id, title, mediaFormat: result.mediaFormat }, { status: 201 });
  } catch (error) {
    const unknown = error instanceof BufferEnqueueOutcomeUnknownError;
    const message = error instanceof Error ? error.message : "Gagal mengirim review ke Buffer.";
    try {
      await getDb().update(articles).set({
        status: unknown ? "ready" : "failed",
        facebookPostId: unknown ? `buffer:pending:${id}` : null,
        errorMessage: message.slice(0, 1_000),
        updatedAt: new Date(),
      }).where(eq(articles.id, id));
    } catch {
      console.error(`[manual-review] Could not save enqueue outcome for ${id}.`);
    }
    return NextResponse.json({ error: message }, { status: unknown ? 202 : 502 });
  }
}
