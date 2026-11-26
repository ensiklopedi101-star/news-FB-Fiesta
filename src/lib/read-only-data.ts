import { and, count, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type { HiveCompBrand } from "./hivecomp-api";

// Restrict the data-access surface to SELECT/execute; callers never mutate rows.
type ReadDatabase = Pick<NeonHttpDatabase<typeof schema>, "select" | "execute">;
const { articles, publisherState, rssSources } = schema;

export function hiveCompPostsQuery(db: ReadDatabase, brand: HiveCompBrand, limit: number) {
  return db.select({
    id: articles.id,
    title: articles.title,
    caption: articles.caption,
    imageUrl: articles.imageUrl,
    publishedAt: articles.publishedAt,
  })
    .from(articles)
    .where(and(
      eq(articles.pageKey, brand === "popbeez" ? "entertainment" : "news"),
      eq(articles.status, "published"),
      // Buffer IDs (including historical rows incorrectly marked published) are
      // not proof of publication. Only stored Facebook IDs + publication times.
      sql`${articles.facebookPostId} ~ '^[0-9]+(_[0-9]+)?$'`,
      isNotNull(articles.publishedAt),
      lte(articles.publishedAt, sql`now()`),
    ))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(limit);
}

export type HealthSnapshot =
  | { ok: false; database: "unavailable" }
  | { ok: boolean; database: "connected"; schema: "ready" | "migration-required"; activeFeeds: number };

export async function readHealthSnapshot(db: ReadDatabase): Promise<HealthSnapshot> {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { ok: false, database: "unavailable" };
  }

  try {
    const [sources, , locks] = await Promise.all([
      db.select({ value: count() }).from(rssSources).where(eq(rssSources.active, true)),
      db.select({ id: rssSources.id, keywords: rssSources.keywords }).from(rssSources).limit(1),
      db.select({ id: publisherState.id }).from(publisherState).where(eq(publisherState.id, 1)).limit(1),
    ]);
    // The singleton is seeded by migrations, never by a health request.
    if (!locks.length) throw new Error("Missing publisher state");
    return { ok: true, database: "connected", schema: "ready", activeFeeds: sources[0]?.value ?? 0 };
  } catch {
    return { ok: false, database: "connected", schema: "migration-required", activeFeeds: 0 };
  }
}
