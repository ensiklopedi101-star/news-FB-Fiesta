import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({
      ok: true,
      database: "connected",
      integrations: {
        gemini: Boolean(process.env.GEMINI_API_KEY),
        facebook: Boolean(process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN),
        feeds: Boolean(process.env.NEWS_FEEDS),
      },
    });
  } catch (error) {
    console.error("[health]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
