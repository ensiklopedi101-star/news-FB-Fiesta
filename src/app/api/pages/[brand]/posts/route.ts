import { getDb } from "@/lib/db";
import { createHiveCompPostsHandler } from "@/lib/hivecomp-api";
import { hiveCompPostsQuery } from "@/lib/read-only-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const handle = createHiveCompPostsHandler({
  getToken: () => process.env.HIVECOMP_API_TOKEN,
  getAppUrl: () => process.env.APP_URL,
  loadPosts: async (brand, limit, signal) => hiveCompPostsQuery(getDb({ signal }), brand, limit),
});

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
