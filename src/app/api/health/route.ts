import { getDb } from "@/lib/db";
import { createHealthHandler } from "@/lib/health-api";
import { readHealthSnapshot } from "@/lib/read-only-data";
import { publisherState, rssSources } from "@/lib/schema";
import { isFacebookPublishingEnabled } from "@/lib/facebook";
import { ensureContentManagerTables } from "@/lib/content-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const handle = createHealthHandler({
  loadSnapshot: async (signal) => readHealthSnapshot(getDb({ signal })),
  getIntegrations: () => ({
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY_FALLBACK),
    groq: Boolean(process.env.GROQ_API_KEY),
    bufferApi: Boolean(process.env.BUFFER_API_KEY?.trim()),
    bufferNews: Boolean(process.env.BUFFER_NEWS_CHANNEL_ID?.trim()),
    bufferEntertainment: Boolean(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim()),
    hivecompApi: Boolean(process.env.HIVECOMP_API_TOKEN?.trim()),
  }),
});

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
  let schemaReady = true;
  let contentManagerSchemaReady = false;
  let activeFeeds = 0;
  try {
    const [sourceCount] = await db.select({ value: count() }).from(rssSources).where(eq(rssSources.active, true));
    await db.select({ id: rssSources.id, keywords: rssSources.keywords }).from(rssSources).limit(1);
    await db.insert(publisherState).values({ id: 1 }).onConflictDoNothing();
    const [lockRow] = await db.select({ id: publisherState.id }).from(publisherState).limit(1);
    if (!lockRow) throw new Error("Migration scheduler belum diterapkan.");
    activeFeeds = sourceCount.value;
    contentManagerSchemaReady = await ensureContentManagerTables();
  } catch (error) {
    schemaReady = false;
    console.error("[health:schema]", error instanceof Error ? error.message : error);
  }

  return NextResponse.json({
    ok: true,
    version: "3.0.0",
    database: "connected",
    schema: schemaReady ? "ready" : "migration-required",
    contentManagerSchema: contentManagerSchemaReady ? "ready" : "degraded",
    activeFeeds,
    integrations: {
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY_FALLBACK?.trim()),
      groq: Boolean(process.env.GROQ_API_KEY?.trim()),
      openRouter: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
      bufferApi: Boolean(process.env.BUFFER_API_KEY?.trim()),
      bufferNews: Boolean(process.env.BUFFER_NEWS_CHANNEL_ID?.trim()),
      bufferEntertainment: Boolean(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim()),
      facebookEntertainment: isFacebookPublishingEnabled("entertainment"),
      feeds: activeFeeds > 0,
    },
  });
}
