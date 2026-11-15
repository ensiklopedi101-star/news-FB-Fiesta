import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
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
  const [updated] = await getDb().update(articles)
    .set({ status: "queued", errorMessage: null, updatedAt: new Date() })
    .where(and(eq(articles.id, id), eq(articles.status, "failed")))
    .returning({ id: articles.id });
  if (!updated) return NextResponse.json({ error: "Artikel tidak ditemukan atau statusnya bukan failed." }, { status: 404 });
  return NextResponse.json({ ok: true, id: updated.id, message: "Artikel dimasukkan kembali ke antrean." });
}
