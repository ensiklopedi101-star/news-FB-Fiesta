import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }
  const parsed = z.object({ id: z.string().uuid(), priority: z.boolean() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "ID artikel atau status prioritas tidak valid." }, { status: 400 });

  const [updated] = await getDb().update(articles)
    .set({ priorityAt: parsed.data.priority ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(articles.id, parsed.data.id), eq(articles.status, "queued")))
    .returning({ id: articles.id, priorityAt: articles.priorityAt });
  if (!updated) {
    const [existing] = await getDb().select({ status: articles.status }).from(articles).where(eq(articles.id, parsed.data.id)).limit(1);
    if (!existing) return NextResponse.json({ error: "Artikel tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ error: "Prioritas hanya bisa diubah saat artikel masih berada di antrean." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, id: updated.id, priority: Boolean(updated.priorityAt) });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }
  const parsed = z.object({ id: z.string().uuid() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "ID artikel tidak valid." }, { status: 400 });

  const [removed] = await getDb().update(articles)
    .set({ status: "removed", updatedAt: new Date() })
    .where(and(eq(articles.id, parsed.data.id), eq(articles.status, "queued")))
    .returning({ id: articles.id });
  if (!removed) {
    const [existing] = await getDb().select({ status: articles.status }).from(articles).where(eq(articles.id, parsed.data.id)).limit(1);
    if (!existing) return NextResponse.json({ error: "Artikel tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ error: "Artikel tidak lagi berada di antrean dan tidak dapat dihapus di sini." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, id: removed.id });
}
