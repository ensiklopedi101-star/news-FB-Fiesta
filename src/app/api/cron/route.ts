import { and, eq, lt, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { publisherState } from "@/lib/schema";
import { runNewsPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = getDb();
  await db.insert(publisherState).values({ id: 1 }).onConflictDoNothing();
  const [lock] = await db.update(publisherState)
    .set({ lockedUntil: sql`now() + interval '3 minutes'`, updatedAt: new Date() })
    .where(and(eq(publisherState.id, 1), lt(publisherState.lockedUntil, sql`now()`)))
    .returning({ id: publisherState.id });
  if (!lock) return NextResponse.json({ ok: true, result: "busy", detail: "Siklus publikasi lain sedang berjalan." });

  try {
    const result = await runNewsPipeline();
    return NextResponse.json({
      ok: result.result !== "failed",
      ...(result.result === "failed" ? { error: result.detail || "Pipeline gagal memproses artikel." } : {}),
      ...result,
    }, { status: result.result === "failed" ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan server.";
    console.error("[cron]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  } finally {
    try {
      await db.update(publisherState)
        .set({ lockedUntil: sql`'epoch'::timestamptz`, updatedAt: new Date() })
        .where(eq(publisherState.id, 1));
    } catch (error) {
      console.error("[cron:unlock]", error instanceof Error ? error.message : error);
    }
  }
}
