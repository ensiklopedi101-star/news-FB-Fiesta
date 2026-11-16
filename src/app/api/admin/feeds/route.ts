import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { rssSources } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedInput = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  pageKey: z.enum(["news", "entertainment"]),
  feedUrl: z.string().trim().url().refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "URL feed harus memakai HTTP/HTTPS tanpa kredensial."),
  language: z.string().trim().min(2).max(12).default("id"),
});

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Body harus berupa JSON yang valid.");
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let parsed;
  try {
    parsed = feedInput.safeParse(await readJson(request));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JSON tidak valid." }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Data feed tidak valid." }, { status: 400 });

  try {
    const [created] = await getDb().insert(rssSources).values(parsed.data).returning();
    return NextResponse.json({ ok: true, feed: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal menyimpan feed.";
    if (/unique|duplicate/i.test(message)) return NextResponse.json({ error: "URL feed tersebut sudah terdaftar." }, { status: 409 });
    console.error("[feed-create]", message);
    return NextResponse.json({ error: "Gagal menyimpan feed. Pastikan migrasi database sudah dijalankan." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid(), active: z.boolean() }).safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ID atau status feed tidak valid." }, { status: 400 });
  const [updated] = await getDb().update(rssSources)
    .set({ active: parsed.data.active, updatedAt: new Date() })
    .where(eq(rssSources.id, parsed.data.id))
    .returning();
  if (!updated) return NextResponse.json({ error: "Feed tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ ok: true, feed: updated });
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "ID feed tidak valid." }, { status: 400 });
  const [deleted] = await getDb().delete(rssSources).where(eq(rssSources.id, parsed.data.id)).returning({ id: rssSources.id });
  if (!deleted) return NextResponse.json({ error: "Feed tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ ok: true, id: deleted.id });
}
