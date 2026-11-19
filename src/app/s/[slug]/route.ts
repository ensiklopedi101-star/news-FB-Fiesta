import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { shortLinks } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SLUG_PATTERN = /^[a-z0-9]{6,12}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_PATTERN.test(slug)) return new NextResponse("Tautan tidak ditemukan.", { status: 404 });

  const [link] = await getDb()
    .select({ targetUrl: shortLinks.targetUrl })
    .from(shortLinks)
    .where(eq(shortLinks.slug, slug))
    .limit(1);
  if (!link) return new NextResponse("Tautan tidak ditemukan.", { status: 404 });

  let destination: URL;
  try {
    destination = new URL(link.targetUrl);
  } catch {
    return new NextResponse("Tautan tidak valid.", { status: 404 });
  }
  // Only public web destinations; prevents javascript:/data: redirects.
  if (destination.protocol !== "https:" && destination.protocol !== "http:") {
    return new NextResponse("Tautan tidak valid.", { status: 404 });
  }

  try {
    await getDb()
      .update(shortLinks)
      .set({ clicks: sql`${shortLinks.clicks} + 1`, lastClickedAt: new Date() })
      .where(eq(shortLinks.slug, slug));
  } catch (error) {
    console.error("[shortlink] Gagal mencatat klik:", error instanceof Error ? error.message : error);
  }

  return NextResponse.redirect(destination.toString(), {
    status: 302,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
