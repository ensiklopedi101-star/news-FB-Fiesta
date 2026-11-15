import "server-only";
import { and, asc, eq, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, type Article } from "@/lib/schema";
import { fetchRecentStories } from "@/lib/feeds";
import { writeNewsCopy } from "@/lib/ai";
import { addSourceComment, createFacebookPhotoPost } from "@/lib/facebook";

const LOCK_STALE_MS = 30 * 60 * 1000;

async function claimNextArticle(): Promise<Article | null> {
  const db = getDb();
  const [queued] = await db.select({ id: articles.id })
    .from(articles)
    .where(eq(articles.status, "queued"))
    .orderBy(asc(articles.createdAt))
    .limit(1);

  let candidateId = queued?.id;
  if (!candidateId) {
    const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
    const [stale] = await db.select({ id: articles.id })
      .from(articles)
      .where(and(eq(articles.status, "processing"), lt(articles.updatedAt, staleBefore)))
      .orderBy(asc(articles.updatedAt))
      .limit(1);
    candidateId = stale?.id;
    if (candidateId) {
      await db.update(articles)
        .set({ status: "queued", updatedAt: new Date() })
        .where(and(eq(articles.id, candidateId), eq(articles.status, "processing")));
    }
  }

  if (!candidateId) {
    const stories = await fetchRecentStories();
    for (const story of stories) {
      const [inserted] = await db.insert(articles).values({
        sourceName: story.sourceName,
        category: story.category,
        sourceUrl: story.sourceUrl,
        urlHash: story.urlHash,
        title: story.title,
        originalTitle: story.title,
        rawText: story.rawText,
        imageUrl: story.imageUrl,
        status: "queued",
      }).onConflictDoNothing({ target: articles.urlHash }).returning({ id: articles.id });
      if (inserted) {
        candidateId = inserted.id;
        break;
      }
    }
  }

  if (!candidateId) return null;
  const [claimed] = await db.update(articles)
    .set({ status: "processing", updatedAt: new Date(), errorMessage: null })
    .where(and(eq(articles.id, candidateId), eq(articles.status, "queued")))
    .returning();
  return claimed ?? null;
}

function getPublicAppUrl() {
  const raw = process.env.APP_URL;
  if (!raw) throw new Error("APP_URL belum diatur ke URL publik deployment Vercel.");
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_URL harus memakai HTTPS untuk deployment publik.");
  }
  return url.toString().replace(/\/$/, "");
}

export type RunResult = {
  result: "published" | "already-published" | "idle" | "failed";
  articleId?: string;
  title?: string;
  detail?: string;
};

export async function runNewsPipeline(): Promise<RunResult> {
  const db = getDb();
  const article = await claimNextArticle();
  if (!article) return { result: "idle", detail: "Tidak ada berita baru di feed yang dikonfigurasi." };

  try {
    const copy = await writeNewsCopy({
      title: article.originalTitle,
      rawText: article.rawText,
      category: article.category,
      sourceName: article.sourceName,
    });
    const caption = `${copy.caption}\n\n📰 ${article.sourceName}\nTautan sumber lengkap ada di komentar pertama.`;
    await db.update(articles)
      .set({ title: copy.title, caption, status: "ready", updatedAt: new Date(), errorMessage: null })
      .where(eq(articles.id, article.id));

    const appUrl = getPublicAppUrl();
    const imageUrl = `${appUrl}/api/og/${article.id}`;
    const postId = await createFacebookPhotoPost({ imageUrl, caption });

    // Simpan ID sebelum membuat komentar agar kegagalan komentar tidak menyebabkan repost.
    await db.update(articles)
      .set({ status: "published", facebookPostId: postId, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(articles.id, article.id));

    try {
      await addSourceComment(postId, article.sourceUrl);
    } catch (commentError) {
      const message = commentError instanceof Error ? commentError.message : "Gagal menambahkan komentar sumber.";
      await db.update(articles).set({ errorMessage: `Posting berhasil; komentar sumber gagal: ${message}`, updatedAt: new Date() })
        .where(eq(articles.id, article.id));
      return { result: "published", articleId: article.id, title: copy.title, detail: "Posting berhasil, tetapi komentar sumber gagal." };
    }

    return { result: "published", articleId: article.id, title: copy.title };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan tidak diketahui saat memproses berita.";
    await db.update(articles)
      .set({ status: "failed", attempts: article.attempts + 1, errorMessage: message.slice(0, 1_000), updatedAt: new Date() })
      .where(and(eq(articles.id, article.id), or(eq(articles.status, "processing"), eq(articles.status, "ready"))));
    console.error(`[pipeline] artikel ${article.id}:`, message);
    return { result: "failed", articleId: article.id, detail: message };
  }
}
