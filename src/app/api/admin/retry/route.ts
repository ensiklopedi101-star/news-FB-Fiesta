import { and, eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { articles } from "@/lib/schema";
import { MAX_QUEUE_AGE_HOURS, isQueueItemExpired } from "@/lib/queue-policy";
import { recordAutomationEvent } from "@/lib/automation-log";

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

  const db = getDb();
  const isBulk = typeof body === "object" && body !== null && "bulk" in body && Boolean((body as { bulk?: unknown }).bulk);

  if (isBulk) {
    const failedRows = await db
      .select({ id: articles.id, sourcePublishedAt: articles.sourcePublishedAt, createdAt: articles.createdAt })
      .from(articles)
      .where(eq(articles.status, "failed"));

    if (failedRows.length === 0) {
      return NextResponse.json({ ok: true, requeued: 0, expired: 0, message: "Tidak ada artikel berstatus gagal." });
    }

    const freshIds: string[] = [];
    const staleIds: string[] = [];
    for (const row of failedRows) {
      const sourceDate = row.sourcePublishedAt ?? row.createdAt;
      if (isQueueItemExpired(sourceDate)) staleIds.push(row.id);
      else freshIds.push(row.id);
    }

    const now = new Date();
    if (staleIds.length > 0) {
      await db.update(articles)
        .set({
          status: "expired",
          errorMessage: `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`,
          updatedAt: now,
        })
        .where(and(inArray(articles.id, staleIds), eq(articles.status, "failed")));
    }

    if (freshIds.length > 0) {
      await db.update(articles)
        .set({ status: "queued", attempts: 0, errorMessage: null, updatedAt: now })
        .where(and(inArray(articles.id, freshIds), eq(articles.status, "failed")));
    }

    await recordAutomationEvent({
      source: "diagnostic",
      trigger: "manual",
      outcome: "ok",
      summary: `Pemulihan massal artikel gagal: ${freshIds.length} dikembalikan ke antrean, ${staleIds.length} kedaluwarsa.`,
      detail: { requeued: freshIds.length, expired: staleIds.length },
    });

    return NextResponse.json({
      ok: true,
      requeued: freshIds.length,
      expired: staleIds.length,
      message: `${freshIds.length} artikel segar dikembalikan ke antrean (${staleIds.length} lewat batas ${MAX_QUEUE_AGE_HOURS} jam).`,
    });
  }

  const id = typeof body === "object" && body !== null && "id" in body ? String(body.id) : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "ID artikel tidak valid." }, { status: 400 });
  }
  const [failed] = await db.select({ sourcePublishedAt: articles.sourcePublishedAt, createdAt: articles.createdAt })
    .from(articles).where(and(eq(articles.id, id), eq(articles.status, "failed"))).limit(1);
  if (!failed) return NextResponse.json({ error: "Artikel tidak ditemukan atau statusnya bukan failed." }, { status: 404 });
  const sourceDate = failed.sourcePublishedAt ?? failed.createdAt;
  if (isQueueItemExpired(sourceDate)) {
    await db.update(articles)
      .set({ status: "expired", errorMessage: `Berita dikeluarkan dari antrean karena sudah lebih dari ${MAX_QUEUE_AGE_HOURS} jam sejak terbit.`, updatedAt: new Date() })
      .where(and(eq(articles.id, id), eq(articles.status, "failed")));
    return NextResponse.json({ error: `Berita sudah melewati batas ${MAX_QUEUE_AGE_HOURS} jam dan tidak dapat dimasukkan kembali.` }, { status: 409 });
  }
  const [updated] = await db.update(articles)
    .set({ status: "queued", attempts: 0, errorMessage: null, updatedAt: new Date() })
    .where(and(eq(articles.id, id), eq(articles.status, "failed")))
    .returning({ id: articles.id });
  if (!updated) return NextResponse.json({ error: "Artikel tidak ditemukan atau statusnya bukan failed." }, { status: 404 });
  return NextResponse.json({ ok: true, id: updated.id, message: "Artikel dimasukkan kembali ke antrean." });
}
