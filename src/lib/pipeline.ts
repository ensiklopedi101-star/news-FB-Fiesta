import "server-only";
import { and, asc, desc, eq, gt, like, lt, or } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { articles, rssSources, type Article } from "@/lib/schema";
import { PUBLISH_POLICY } from "@/lib/schedule";
import { writeNewsCopy } from "@/lib/ai";
import { enqueueBufferFacebookPost, getBufferConfigurationGaps } from "@/lib/buffer";

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

  if (!candidateId) return null;
  const [claimed] = await db.update(articles)
    .set({ status: "processing", updatedAt: new Date(), errorMessage: null })
    .where(and(eq(articles.id, candidateId), eq(articles.status, "queued")))
    .returning();
  return claimed ?? null;
}

async function getPublishingPause(): Promise<{ detail: string; nextAllowedAt: string } | null> {
  const now = Date.now();
  const cutoff = new Date(now - PUBLISH_POLICY.maxPerHour * 60 * 60 * 1000);
  const db = getDb();
  const [facebookPublished, bufferQueued] = await Promise.all([
    db.select({ occurredAt: articles.publishedAt })
      .from(articles)
      .where(and(eq(articles.status, "published"), gt(articles.publishedAt, cutoff)))
      .orderBy(desc(articles.publishedAt))
      .limit(PUBLISH_POLICY.maxPerHour),
    db.select({ occurredAt: articles.updatedAt })
      .from(articles)
      .where(and(eq(articles.status, "ready"), like(articles.facebookPostId, "buffer:%"), gt(articles.updatedAt, cutoff)))
      .orderBy(desc(articles.updatedAt))
      .limit(PUBLISH_POLICY.maxPerHour),
  ]);
  const recent = [...facebookPublished, ...bufferQueued]
    .filter((item): item is { occurredAt: Date } => item.occurredAt instanceof Date)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, PUBLISH_POLICY.maxPerHour);
  const lastPublishedAt = recent[0]?.occurredAt.getTime();
  const minimumGapAt = lastPublishedAt === undefined ? now : lastPublishedAt + PUBLISH_POLICY.minimumGapMinutes * 60 * 1000;
  const oldestInWindow = recent[PUBLISH_POLICY.maxPerHour - 1];
  const hourlyLimitAt = recent.length >= PUBLISH_POLICY.maxPerHour && oldestInWindow
    ? oldestInWindow.occurredAt.getTime() + 60 * 60 * 1000
    : now;
  const nextAllowedAt = Math.max(minimumGapAt, hourlyLimitAt);
  if (nextAllowedAt <= now) return null;
  return {
    detail: recent.length >= PUBLISH_POLICY.maxPerHour
      ? "Batas publikasi tercapai: maksimal 2 artikel dalam 60 menit."
      : "Jeda publikasi minimum 15 menit belum terpenuhi.",
    nextAllowedAt: new Date(nextAllowedAt).toISOString(),
  };
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
  result: "queued" | "idle" | "failed" | "rate-limited";
  articleId?: string;
  title?: string;
  detail?: string;
};

export async function runNewsPipeline(): Promise<RunResult> {
  const db = getDb();
  const activePages = await db.select({ pageKey: rssSources.pageKey }).from(rssSources).where(eq(rssSources.active, true)).groupBy(rssSources.pageKey);
  const configurationGaps = getBufferConfigurationGaps(activePages.map(({ pageKey }) => pageKey));
  if (configurationGaps.length) {
    return { result: "failed", detail: `Konfigurasi Buffer belum lengkap: ${configurationGaps.join(", ")}. Artikel tetap di antrean.` };
  }
  const pause = await getPublishingPause();
  if (pause) return { result: "rate-limited", detail: `${pause.detail} Berikutnya bisa mencoba setelah ${pause.nextAllowedAt}.` };
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
    const bufferPostId = await enqueueBufferFacebookPost({
      pageKey: article.pageKey,
      imageUrl,
      caption,
      sourceUrl: article.sourceUrl,
    });

    // Buffer menerima konten ke antreannya; Facebook akan menerbitkannya pada slot jadwal Buffer.
    // Gunakan prefix untuk membedakan ID Buffer dari ID posting Facebook lama tanpa migrasi schema.
    await db.update(articles)
      .set({ status: "ready", facebookPostId: `buffer:${bufferPostId}`, publishedAt: null, updatedAt: new Date(), errorMessage: null })
      .where(eq(articles.id, article.id));

    return { result: "queued", articleId: article.id, title: copy.title, detail: "Konten masuk ke antrean Buffer untuk dijadwalkan." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan tidak diketahui saat memproses berita.";
    await db.update(articles)
      .set({ status: "failed", attempts: article.attempts + 1, errorMessage: message.slice(0, 1_000), updatedAt: new Date() })
      .where(and(eq(articles.id, article.id), or(eq(articles.status, "processing"), eq(articles.status, "ready"))));
    console.error(`[pipeline] artikel ${article.id}:`, message);
    return { result: "failed", articleId: article.id, detail: message };
  }
}
