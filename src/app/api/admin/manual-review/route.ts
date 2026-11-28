import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { ratingSegmentForMediaType } from "@/lib/content-taxonomy";
import { isAuthorized } from "@/lib/auth";
import {
  createManualReview,
  parseManualReview,
  buildManualReviewCaption,
  buildManualReviewNarration,
  buildManualReviewSourceComment,
  MANUAL_REVIEW_SOURCE_NAME,
  manualImageReferer,
} from "@/lib/manual-review";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { addPageComment, FacebookPublishOutcomeUnknownError } from "@/lib/facebook";
import { isInstagramPublishingEnabled, publishInstagramPost } from "@/lib/instagram";
import { publishPost, usesDirectFacebookPublishing } from "@/lib/publisher";
import { storeArticleImageInBlob } from "@/lib/blob-image";
import { claimEditorialDraft, finishEditorialDraft, saveEditorialDraft } from "@/lib/editorial-drafts";
import { previewDataUrls, renderManualReviewPreview } from "@/lib/editorial-preview";

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
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Permintaan review tidak valid." }, { status: 400 });
  }
  const action = (body as { action?: unknown }).action;
  if (action === "preview") return preview((body as { review?: unknown }).review);
  if (action === "publish") {
    const draftId = (body as { draftId?: unknown }).draftId;
    if (typeof draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(draftId)) {
      return NextResponse.json({ error: "ID pratinjau review tidak valid." }, { status: 400 });
    }
    return publishPreview(draftId);
  }
  return NextResponse.json({ error: "Pilih action preview atau publish. Review manual tidak diterbitkan tanpa pratinjau." }, { status: 400 });
}

async function preview(value: unknown) {
  let review;
  try {
    review = createManualReview(value);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data review tidak valid." }, { status: 400 });
  }

  const draftId = randomUUID();
  try {
    review.items = await Promise.all(review.items.map(async (item, index) => ({
      ...item,
      imageUrl: await storeArticleImageInBlob(`${draftId}-review-${index + 1}`, item.imageUrl, manualImageReferer(item.imageUrl)) ?? item.imageUrl,
    })));
    const images = await renderManualReviewPreview(review);
    const draft = await saveEditorialDraft({ id: draftId, kind: "rating_top_5", payload: review as unknown as Record<string, unknown> });
    return NextResponse.json({
      ok: true,
      result: "previewed",
      draftId: draft.id,
      previewImages: previewDataUrls(images),
      expiresAt: draft.expiresAt.toISOString(),
      title: review.headline,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyusun pratinjau carousel.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function publishPreview(draftId: string) {
  let draft;
  try {
    draft = await claimEditorialDraft(draftId, "rating_top_5");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draf review tidak dapat dibuka." }, { status: 503 });
  }
  if (!draft) return NextResponse.json({ error: "Pratinjau sudah digunakan atau kedaluwarsa. Buat pratinjau baru." }, { status: 409 });
  const review = parseManualReview(JSON.stringify(draft.payload));
  if (!review || review.items.some((item) => !item.sourceUrl)) {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: "Payload pratinjau review tidak valid atau tidak memiliki sumber." });
    return NextResponse.json({ error: "Payload pratinjau review tidak valid atau tidak memiliki sumber." }, { status: 409 });
  }

  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: "APP_URL belum diatur." });
    return NextResponse.json({ error: "APP_URL belum diatur." }, { status: 503 });
  }
  let publicAppUrl: string;
  try {
    publicAppUrl = new URL(appUrl).toString().replace(/\/$/, "");
  } catch {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: "APP_URL tidak valid." });
    return NextResponse.json({ error: "APP_URL tidak valid." }, { status: 503 });
  }

  const id = randomUUID();
  const createdAt = new Date();
  const storedImages = review.items.map((item) => item.imageUrl);
  const title = review.headline;
  const imageUrls = Array.from({ length: 6 }, (_, index) => `${publicAppUrl}/api/og/${id}?slide=${index + 1}`);
  const directFacebook = usesDirectFacebookPublishing("entertainment");
  const caption = buildManualReviewCaption(review, { includeSources: !directFacebook });
  const instagramCaption = buildManualReviewCaption(review, { includeSources: true });
  const sourceComment = buildManualReviewSourceComment(review);
  let articleInserted = false;
  let acceptedPublish: Awaited<ReturnType<typeof publishPost>> | null = null;

  try {
    const db = getDb();
    await db.insert(articles).values({
      id,
      sourceName: MANUAL_REVIEW_SOURCE_NAME,
      category: review.mediaType,
      pageKey: "entertainment",
      sourceUrl: review.items[0]!.sourceUrl!,
      urlHash: createHash("sha256").update(`manual-review:${id}`).digest("hex"),
      title,
      originalTitle: title,
      rawText: JSON.stringify(review),
      imageUrl: storedImages[0] ?? null,
      imageUrls: storedImages,
      caption,
      narrationScript: buildManualReviewNarration(review),
      pillar: "list",
      segment: ratingSegmentForMediaType(review.mediaType),
      contentFormat: "carousel",
      status: "processing",
      postFormat: "carousel",
      facebookPostId: `${directFacebook ? "facebook" : "buffer"}:pending:${id}`,
      createdAt,
      updatedAt: createdAt,
    });
    articleInserted = true;

    const result = await publishPost({ pageKey: "entertainment", imageUrl: imageUrls[0]!, imageUrls, caption });
    acceptedPublish = result;
    if (result.provider === "facebook") {
      await db.update(articles).set({
        status: "published",
        postFormat: result.mediaFormat,
        contentFormat: result.mediaFormat === "carousel" ? "carousel" : "single_image",
        facebookPostId: result.postId,
        publishedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      }).where(eq(articles.id, id));

      // Sources stay in a first comment on Facebook; Instagram receives a source block in its caption.
      let commentNote = "";
      try {
        await addPageComment("entertainment", result.postId, sourceComment);
      } catch (commentError) {
        const commentMessage = commentError instanceof Error ? commentError.message : "Komentar sumber gagal dikirim.";
        commentNote = `Komentar sumber Facebook gagal: ${commentMessage.slice(0, 160)}`;
        await db.update(articles).set({
          errorMessage: `Posting berhasil; komentar sumber gagal: ${commentMessage}`.slice(0, 1_000),
          updatedAt: new Date(),
        }).where(eq(articles.id, id));
        console.error(`[manual-review] Komentar sumber gagal untuk ${id}:`, commentMessage);
      }

      let instagramNote = "";
      if (isInstagramPublishingEnabled()) {
        try {
          await publishInstagramPost({ imageUrls, caption: instagramCaption });
          console.info(`[manual-review] Instagram terkirim untuk ${id}.`);
        } catch (instagramError) {
          const detail = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
          instagramNote = ` Instagram belum terkirim: ${detail.slice(0, 160)}`;
          await db.update(articles).set({
            errorMessage: `Posting Facebook berhasil; Instagram gagal: ${detail}`.slice(0, 1_000),
            updatedAt: new Date(),
          }).where(eq(articles.id, id));
          console.warn(`[manual-review] Instagram gagal untuk ${id}: ${detail.slice(0, 200)}`);
        }
      }
      await finishEditorialDraft({ id: draftId, status: "published", resultId: id });
      const detail = [commentNote, instagramNote.trim()].filter(Boolean).join(" ");
      return NextResponse.json({ ok: true, id, title, mediaFormat: result.mediaFormat, provider: result.provider, detail: detail || undefined }, { status: 201 });
    }

    await db.update(articles).set({
      status: "ready",
      postFormat: result.mediaFormat,
      contentFormat: result.mediaFormat === "carousel" ? "carousel" : "single_image",
      facebookPostId: `buffer:${result.postId}`,
      updatedAt: new Date(),
      errorMessage: result.mediaFormat === "single"
        ? "Buffer menolak carousel enam slide dan hanya menerima cover; tautan sumber tetap dicantumkan di caption antrean."
        : null,
    }).where(eq(articles.id, id));
    await finishEditorialDraft({ id: draftId, status: "submitted", resultId: id });
    return NextResponse.json({ ok: true, id, title, mediaFormat: result.mediaFormat, provider: result.provider }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengirim review ke halaman Facebook.";
    if (acceptedPublish) {
      const accepted = acceptedPublish;
      const published = accepted.provider === "facebook";
      const updatedAt = new Date();
      const trackingRow = {
        status: published ? "published" as const : "ready" as const,
        postFormat: accepted.mediaFormat,
        facebookPostId: published ? accepted.postId : `buffer:${accepted.postId}`,
        ...(published ? { publishedAt: updatedAt } : {}),
        errorMessage: `Penerbitan sudah dikonfirmasi, tetapi pencatatan lanjutan gagal: ${message}`.slice(0, 1_000),
        updatedAt,
      };
      await getDb().update(articles).set({
        ...trackingRow,
        contentFormat: accepted.mediaFormat === "carousel" ? "carousel" : "single_image",
      }).where(eq(articles.id, id)).catch(async () => {
        await getDb().update(articles).set(trackingRow).where(eq(articles.id, id)).catch(() => undefined);
      });
      await finishEditorialDraft({
        id: draftId,
        status: published ? "published" : "submitted",
        resultId: id,
        errorMessage: message,
      }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        id,
        title,
        mediaFormat: accepted.mediaFormat,
        provider: accepted.provider,
        detail: `${published ? "Facebook mengonfirmasi post terbit" : "Buffer mengonfirmasi post masuk antrean"}, tetapi pencatatan lanjutan bermasalah. Jangan kirim ulang; periksa halaman/antrean terlebih dahulu.`,
      }, { status: 201 });
    }
    const unknown = error instanceof BufferEnqueueOutcomeUnknownError || error instanceof FacebookPublishOutcomeUnknownError;
    const provider = directFacebook ? "facebook" : "buffer";
    if (articleInserted) {
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
    }
    await finishEditorialDraft({ id: draftId, status: unknown ? "outcome_unknown" : "failed", resultId: articleInserted ? id : null, errorMessage: message }).catch(() => undefined);
    return NextResponse.json({ error: message, provider, ...(unknown ? { outcomeUnknown: true } : {}) }, { status: unknown ? 202 : 502 });
  }
}
