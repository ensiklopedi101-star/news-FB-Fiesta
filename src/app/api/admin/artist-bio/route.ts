import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import {
  ARTIST_BIO_SOURCE_NAME,
  artistBioHeadline,
  buildArtistBioCaption,
  buildArtistBioNarration,
  buildArtistBioSourceComment,
  createArtistBio,
  parseArtistBio,
} from "@/lib/artist-bio";
import { renderArtistBioPreview, previewDataUrls } from "@/lib/editorial-preview";
import { claimEditorialDraft, finishEditorialDraft, saveEditorialDraft } from "@/lib/editorial-drafts";
import { storeArticleImageInBlob } from "@/lib/blob-image";
import { manualImageReferer } from "@/lib/manual-review";
import { BufferEnqueueOutcomeUnknownError } from "@/lib/buffer-api";
import { addPageComment, FacebookPublishOutcomeUnknownError } from "@/lib/facebook";
import { isInstagramPublishingEnabled, publishInstagramPost } from "@/lib/instagram";
import { publishPost, usesDirectFacebookPublishing } from "@/lib/publisher";

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
    return NextResponse.json({ error: "Permintaan Artis Bio tidak valid." }, { status: 400 });
  }
  const action = (body as { action?: unknown }).action;
  if (action === "preview") return preview((body as { bio?: unknown }).bio);
  if (action === "publish") {
    const draftId = (body as { draftId?: unknown }).draftId;
    if (typeof draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(draftId)) {
      return NextResponse.json({ error: "ID pratinjau Artis Bio tidak valid." }, { status: 400 });
    }
    return publishPreview(draftId);
  }
  return NextResponse.json({ error: "Pilih action preview atau publish. Artis Bio tidak diterbitkan tanpa pratinjau." }, { status: 400 });
}

async function preview(value: unknown) {
  let bio;
  try {
    bio = createArtistBio(value);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Data Artis Bio tidak valid." }, { status: 400 });
  }

  const draftId = randomUUID();
  try {
    bio.facts = await Promise.all(bio.facts.map(async (fact, index) => ({
      ...fact,
      imageUrl: await storeArticleImageInBlob(`${draftId}-bio-${index + 1}`, fact.imageUrl, manualImageReferer(fact.imageUrl)) ?? fact.imageUrl,
    })));
    const images = await renderArtistBioPreview(bio);
    const draft = await saveEditorialDraft({ id: draftId, kind: "artis_bio", payload: bio as unknown as Record<string, unknown> });
    return NextResponse.json({
      ok: true,
      result: "previewed",
      draftId: draft.id,
      previewImages: previewDataUrls(images),
      expiresAt: draft.expiresAt.toISOString(),
      title: artistBioHeadline(bio.name),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyusun pratinjau Artis Bio.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

async function publishPreview(draftId: string) {
  let draft;
  try {
    draft = await claimEditorialDraft(draftId, "artis_bio");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draf Artis Bio tidak dapat dibuka." }, { status: 503 });
  }
  if (!draft) return NextResponse.json({ error: "Pratinjau sudah digunakan atau kedaluwarsa. Buat pratinjau baru." }, { status: 409 });
  const bio = parseArtistBio(JSON.stringify(draft.payload));
  if (!bio) {
    await finishEditorialDraft({ id: draftId, status: "failed", errorMessage: "Payload pratinjau Artis Bio tidak valid." });
    return NextResponse.json({ error: "Payload pratinjau Artis Bio tidak valid." }, { status: 409 });
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
  const title = artistBioHeadline(bio.name);
  const imageUrls = bio.facts.map((_, index) => `${publicAppUrl}/api/og/${id}?slide=${index + 1}`);
  const directFacebook = usesDirectFacebookPublishing("entertainment");
  const caption = buildArtistBioCaption(bio, { includeSources: !directFacebook });
  const instagramCaption = buildArtistBioCaption(bio, { includeSources: true });
  const sourceComment = buildArtistBioSourceComment(bio);
  let articleInserted = false;
  let acceptedPublish: Awaited<ReturnType<typeof publishPost>> | null = null;

  try {
    const db = getDb();
    await db.insert(articles).values({
      id,
      sourceName: ARTIST_BIO_SOURCE_NAME,
      category: "ARTIS BIO",
      pageKey: "entertainment",
      sourceUrl: bio.facts[0]!.sourceUrl,
      urlHash: createHash("sha256").update(`artist-bio:${id}`).digest("hex"),
      title,
      originalTitle: title,
      rawText: JSON.stringify(bio),
      imageUrl: bio.facts[0]!.imageUrl,
      imageUrls: bio.facts.map((fact) => fact.imageUrl),
      caption,
      editorialTake: bio.facts.map((fact) => fact.fact).join(" "),
      narrationScript: buildArtistBioNarration(bio),
      pillar: "analysis",
      segment: "artis_bio",
      contentFormat: "carousel",
      status: "processing",
      postFormat: "carousel",
      facebookPostId: `${directFacebook ? "facebook" : "buffer"}:pending:${id}`,
      updatedAt: new Date(),
    });
    articleInserted = true;

    const result = await publishPost({ pageKey: "entertainment", imageUrl: imageUrls[0]!, imageUrls, caption, strictCarousel: true });
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
      let commentNote = "";
      try {
        await addPageComment("entertainment", result.postId, sourceComment);
      } catch (commentError) {
        const detail = commentError instanceof Error ? commentError.message : "Komentar sumber gagal dikirim.";
        commentNote = `Komentar sumber Facebook gagal: ${detail.slice(0, 160)}`;
        await db.update(articles).set({ errorMessage: `Posting berhasil; komentar sumber gagal: ${detail}`.slice(0, 1_000), updatedAt: new Date() }).where(eq(articles.id, id));
        console.error(`[artist-bio] komentar sumber gagal untuk ${id}:`, detail);
      }

      let instagramNote = "";
      if (isInstagramPublishingEnabled()) {
        try {
          await publishInstagramPost({ imageUrls, caption: instagramCaption });
          console.info(`[artist-bio] Instagram terkirim untuk ${id}.`);
        } catch (instagramError) {
          const detail = instagramError instanceof Error ? instagramError.message : "Instagram gagal.";
          instagramNote = ` Instagram belum terkirim: ${detail.slice(0, 160)}`;
          await db.update(articles).set({ errorMessage: `Posting Facebook berhasil; Instagram gagal: ${detail}`.slice(0, 1_000), updatedAt: new Date() }).where(eq(articles.id, id));
        }
      }
      await finishEditorialDraft({ id: draftId, status: "published", resultId: id });
      const responseDetail = [commentNote, instagramNote.trim()].filter(Boolean).join(" ");
      return NextResponse.json({ ok: true, id, title, provider: result.provider, mediaFormat: result.mediaFormat, detail: responseDetail || undefined }, { status: 201 });
    }

    await db.update(articles).set({
      status: "ready",
      postFormat: result.mediaFormat,
      contentFormat: result.mediaFormat === "carousel" ? "carousel" : "single_image",
      facebookPostId: `buffer:${result.postId}`,
      updatedAt: new Date(),
      errorMessage: result.mediaFormat === "single" ? "Buffer hanya menerima cover; pratinjau empat foto tidak masuk sebagai carousel." : null,
    }).where(eq(articles.id, id));
    await finishEditorialDraft({ id: draftId, status: "submitted", resultId: id });
    return NextResponse.json({ ok: true, id, title, provider: result.provider, mediaFormat: result.mediaFormat }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menerbitkan Artis Bio.";
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
      await getDb().update(articles).set({
        status: unknown ? "ready" : "failed",
        facebookPostId: unknown ? `${provider}:pending:${id}` : null,
        errorMessage: message.slice(0, 1_000),
        updatedAt: new Date(),
      }).where(eq(articles.id, id)).catch(() => undefined);
    }
    await finishEditorialDraft({ id: draftId, status: unknown ? "outcome_unknown" : "failed", resultId: articleInserted ? id : null, errorMessage: message }).catch(() => undefined);
    return NextResponse.json({ error: message, provider, ...(unknown ? { outcomeUnknown: true } : {}) }, { status: unknown ? 202 : 502 });
  }
}
