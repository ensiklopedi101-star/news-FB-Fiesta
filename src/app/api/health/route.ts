import { getDb } from "@/lib/db";
import { createHealthHandler } from "@/lib/health-api";
import { readHealthSnapshot } from "@/lib/read-only-data";

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
