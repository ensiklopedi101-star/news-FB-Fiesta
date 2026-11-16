import { count, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rssSources } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
    await db.execute(sql`select 1`);
  } catch (error) {
    console.error("[health:database]", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, database: "unavailable" }, { status: 503 });
  }

  let schemaReady = true;
  let activeFeeds = 0;
  try {
    const [sourceCount] = await db.select({ value: count() }).from(rssSources).where(eq(rssSources.active, true));
    activeFeeds = sourceCount.value;
  } catch (error) {
    schemaReady = false;
    console.error("[health:schema]", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({
    ok: true,
    database: "connected",
    schema: schemaReady ? "ready" : "migration-required",
    activeFeeds,
    integrations: {
      gemini: Boolean(process.env.GEMINI_API_KEY),
      facebookNews: Boolean((process.env.FB_NEWS_PAGE_ID && process.env.FB_NEWS_PAGE_ACCESS_TOKEN) || (process.env.FB_PAGE_ID && process.env.FB_PAGE_ACCESS_TOKEN)),
      facebookEntertainment: Boolean(process.env.FB_ENTERTAINMENT_PAGE_ID && process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN),
      feeds: activeFeeds > 0,
    },
  });
}
