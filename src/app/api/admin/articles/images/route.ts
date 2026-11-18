import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { storeArticleImageInBlob } from "@/lib/blob-image";
import { isSafePublicImageUrl } from "@/lib/safe-url";
import { articles } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const payloadSchema = z.object({
  id: z.string().uuid(),
  imageUrls: z.array(z.string().url().refine(isSafePublicImageUrl, "Gunakan tautan gambar publik HTTPS yang aman.")).max(2),
});

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Masukkan maksimal dua URL gambar publik HTTPS yang valid." }, { status: 400 });

  const db = getDb();
  const [article] = await db.select({ id: articles.id, sourceUrl: articles.sourceUrl, status: articles.status })
    .from(articles).where(eq(articles.id, parsed.data.id)).limit(1);
  if (!article) return NextResponse.json({ error: "Artikel tidak ditemukan." }, { status: 404 });
  if (article.status !== "queued") return NextResponse.json({ error: "Gambar hanya bisa diedit selama artikel masih berada di antrean." }, { status: 409 });

  const imageUrls = await Promise.all(parsed.data.imageUrls.map(async (url, index) =>
    await storeArticleImageInBlob(`${article.id}-manual-${index + 1}`, url, article.sourceUrl) ?? url));
  const [updated] = await db.update(articles)
    .set({ manualImageUrls: imageUrls, imageUrls, imageUrl: imageUrls[0] ?? null, updatedAt: new Date() })
    .where(and(eq(articles.id, article.id), eq(articles.status, "queued")))
    .returning({ id: articles.id });
  if (!updated) return NextResponse.json({ error: "Status artikel berubah. Muat ulang antrean lalu coba lagi." }, { status: 409 });
  return NextResponse.json({ ok: true, id: updated.id, imageUrls });
}
