import { count, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { publisherState, rssSources } from "@/lib/schema";

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
    await db.select({ id: rssSources.id, keywords: rssSources.keywords }).from(rssSources).limit(1);
    await db.insert(publisherState).values({ id: 1 }).onConflictDoNothing();
    const [lockRow] = await db.select({ id: publisherState.id }).from(publisherState).limit(1);
    if (!lockRow) throw new Error("Migration scheduler belum diterapkan.");
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
      gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_FALLBACK),
      groq: Boolean(process.env.GROQ_API_KEY),
      bufferApi: Boolean(process.env.BUFFER_API_KEY?.trim()),
      bufferNews: Boolean(process.env.BUFFER_NEWS_CHANNEL_ID?.trim()),
      bufferEntertainment: Boolean(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim()),
      feeds: activeFeeds > 0,
    },
  });
}
