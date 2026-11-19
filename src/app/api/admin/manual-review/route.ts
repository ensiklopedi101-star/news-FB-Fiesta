import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { isAuthorized } from "@/lib/auth";
import { createManualReview, buildManualReviewCaption, MANUAL_REVIEW_FOLLOW_COMMENT, MANUAL_REVIEW_SOURCE_NAME, manualImageReferer } from "@/lib/manual-review";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { addPageComment, FacebookPublishOutcomeUnknownError } from "@/lib/facebook";
import { publishPost, usesDirectFacebookPublishing } from "@/lib/publisher";
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

  const id = randomUUID();
  const createdAt = new Date();
  const originalImages = review.items.map((item) => item.imageUrl);
  const storedImages = await Promise.all(originalImages.map(async (url, index) =>
    await storeArticleImageInBlob(`${id}-review-${index + 1}`, url, manualImageReferer(url)) ?? url));
  review.items = review.items.map((item, index) => ({ ...item, imageUrl: storedImages[index]! }));
  const title = review.headline;
  const imageUrls = Array.from({ length: 6 }, (_, index) => `${publicAppUrl}/api/og/${id}?slide=${index + 1}`);
  const directFacebook = usesDirectFacebookPublishing("entertainment");
  // Direct Graph posts stay link-free and use a first comment; the Buffer fallback keeps the follow link in the caption.
  const caption = directFacebook
    ? buildManualReviewCaption(review)
    : `${buildManualReviewCaption(review)}\n\n${MANUAL_REVIEW_FOLLOW_COMMENT}`;

  try {
    const db = getDb();
    await db.insert(articles).values({
      id,
      sourceName: MANUAL_REVIEW_SOURCE_NAME,
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
      facebookPostId: `${directFacebook ? "facebook" : "buffer"}:pending:${id}`,
      createdAt,
      updatedAt: createdAt,
    });

    const result = await publishPost({
      pageKey: "entertainment",
      imageUrl: imageUrls[0]!,
      imageUrls,
      caption,
    });

    if (result.provider === "facebook") {
      await db.update(articles).set({
        status: "published",
        postFormat: result.mediaFormat,
        facebookPostId: result.postId,
        publishedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      }).where(eq(articles.id, id));

      // The caption stays link-free; the follow link goes into the first comment.
      try {
        await addPageComment("entertainment", result.postId, MANUAL_REVIEW_FOLLOW_COMMENT);
      } catch (commentError) {
        const commentMessage = commentError instanceof Error ? commentError.message : "Komentar tautan gagal dikirim.";
        await db.update(articles).set({
          errorMessage: `Posting berhasil; komentar tautan gagal: ${commentMessage}`.slice(0, 1_000),
          updatedAt: new Date(),
        }).where(eq(articles.id, id));
        console.error(`[manual-review] Komentar tautan gagal untuk ${id}:`, commentMessage);
      }

      return NextResponse.json({ ok: true, id, title, mediaFormat: result.mediaFormat, provider: result.provider }, { status: 201 });
    }

    await db.update(articles).set({
      status: "ready",
      postFormat: result.mediaFormat,
      facebookPostId: `buffer:${result.postId}`,
      updatedAt: new Date(),
      errorMessage: result.mediaFormat === "single"
        ? "Buffer menolak carousel enam slide dan hanya menerima cover."
        : null,
    }).where(eq(articles.id, id));
    return NextResponse.json({ ok: true, id, title, mediaFormat: result.mediaFormat, provider: result.provider }, { status: 201 });
  } catch (error) {
    const unknown = error instanceof BufferEnqueueOutcomeUnknownError || error instanceof FacebookPublishOutcomeUnknownError;
    const message = error instanceof Error ? error.message : "Gagal mengirim review ke halaman Facebook.";
    const provider = directFacebook ? "facebook" : "buffer";
    try {
      await getDb().update(articles).set({
        status: unknown ? "ready" : "failed",
        facebookPostId: unknown ? `${provider}:pending:${id}` : null,
        errorMessage: message.slice(0, 1_000),
        updatedAt: new Date(),
      }).where(eq(articles.id, id));
    } catch {
      console.error(`[manual-review] Could not save publish outcome for ${id}.`);
    }
    return NextResponse.json({ error: message, provider }, { status: unknown ? 202 : 502 });
  }
}
