import { and, eq, like } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addSourceComment } from "@/lib/facebook";
import { articles } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON." }, { status: 400 });
  }
  const id = typeof body === "object" && body !== null && "id" in body ? String(body.id) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "ID artikel tidak valid." }, { status: 400 });
  }

  const [article] = await getDb().select({ id: articles.id, postId: articles.facebookPostId, sourceUrl: articles.sourceUrl })
    .from(articles)
    .where(and(
      eq(articles.id, id),
      eq(articles.status, "published"),
      like(articles.errorMessage, "Posting berhasil; komentar sumber gagal:%"),
    ))
    .limit(1);
  if (!article?.postId) return NextResponse.json({ error: "Tidak ada komentar sumber yang gagal untuk artikel ini." }, { status: 404 });

  try {
    await addSourceComment(article.postId, article.sourceUrl);
    await getDb().update(articles).set({ errorMessage: null, updatedAt: new Date() }).where(eq(articles.id, id));
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengirim komentar sumber.";
    await getDb().update(articles).set({ errorMessage: `Posting berhasil; komentar sumber gagal: ${message.slice(0, 800)}`, updatedAt: new Date() }).where(eq(articles.id, id));
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
