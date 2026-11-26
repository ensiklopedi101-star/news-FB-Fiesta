import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createHealthHandler } from "../src/lib/health-api";
import { hiveCompPostsQuery, readHealthSnapshot } from "../src/lib/read-only-data";
import * as schema from "../src/lib/schema";

test("posts query is a bounded SELECT for the correct brand, newest publication first", () => {
  const db = drizzle.mock({ schema });
  for (const [brand, pageKey] of [["popbeez", "entertainment"], ["nusabeez", "news"]] as const) {
    const query = hiveCompPostsQuery(db, brand, 3).toSQL();
    assert.deepEqual(query.params, [pageKey, "published", 3]);
    assert.match(query.sql, /^select /i);
    const selection = query.sql.split(" from ")[0];
    for (const field of ["id", "title", "caption", "image_url", "published_at"]) {
      assert.ok(selection.includes(`"${field}"`));
    }
    for (const field of ["raw_text", "error_message", "source_url", "facebook_post_id", "created_at"]) {
      assert.equal(selection.includes(`"${field}"`), false);
    }
    // A queued Buffer reference (even on an old `published` row) is not a FB ID.
    assert.ok(query.sql.includes('"articles"."facebook_post_id" ~ \'^[0-9]+(_[0-9]+)?$\''));
    assert.match(query.sql, /"published_at" is not null/);
    assert.match(query.sql, /"published_at" <= now\(\)/);
    assert.match(query.sql, /order by "articles"\."published_at" desc, "articles"\."id" desc limit \$3$/);
  }
});

function createReadDatabase(options: { down?: boolean; missingSchema?: boolean; missingLock?: boolean } = {}) {
  const statements: string[] = [];
  const client = {
    query: async (statement: string) => {
      statements.push(statement);
      assert.match(statement, /^select /i, "Health checks must never issue writes");
      if (options.down) throw new Error("private connection string must not escape");
      if (options.missingSchema && statement.includes('"keywords"')) throw new Error("column not found");
      if (statement.includes("count(*)")) return { rows: [["2"]] };
      if (statement.includes('from "publisher_state"')) return { rows: options.missingLock ? [] : [[1]] };
      return { rows: [] };
    },
  } as unknown as NeonQueryFunction<false, false>;
  return { db: drizzle({ client, schema }), statements };
}

test("health snapshot checks connectivity, schema and the migration-seeded singleton using SELECT only", async () => {
  const { db, statements } = createReadDatabase();
  assert.deepEqual(await readHealthSnapshot(db), {
    ok: true, database: "connected", schema: "ready", activeFeeds: 2,
  });
  assert.equal(statements.length, 4);
  assert.ok(statements.every((statement) => /^select /i.test(statement)));
});

test("health detects unavailable DB and missing migrations without trying to repair/write data", async () => {
  const down = createReadDatabase({ down: true });
  assert.deepEqual(await readHealthSnapshot(down.db), { ok: false, database: "unavailable" });
  assert.equal(down.statements.length, 1);

  for (const options of [{ missingSchema: true }, { missingLock: true }]) {
    const { db, statements } = createReadDatabase(options);
    assert.deepEqual(await readHealthSnapshot(db), {
      ok: false, database: "connected", schema: "migration-required", activeFeeds: 0,
    });
    assert.ok(statements.every((statement) => /^select /i.test(statement)));
  }
});

test("health GET is public, read-only, non-cacheable JSON with boolean integration flags", async () => {
  const { db } = createReadDatabase();
  const handler = createHealthHandler({
    loadSnapshot: async (signal) => {
      assert.ok(signal instanceof AbortSignal);
      return readHealthSnapshot(db);
    },
    getIntegrations: () => ({ hivecompApi: true, bufferApi: false }),
  });
  const response = await handler(new Request("https://backend.example/api/health"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type") ?? "", /^application\/json\b/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.deepEqual(await response.json(), {
    ok: true, database: "connected", schema: "ready", activeFeeds: 2,
    integrations: { hivecompApi: true, bufferApi: false, feeds: true },
  });
});

test("health returns JSON 503 for connectivity/schema failures without exposing details", async () => {
  for (const options of [{ down: true }, { missingLock: true }]) {
    const { db } = createReadDatabase(options);
    const response = await createHealthHandler({
      loadSnapshot: async () => readHealthSnapshot(db),
      getIntegrations: () => ({}),
    })(new Request("https://backend.example/api/health"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(JSON.stringify(body).includes("private connection string"), false);
  }
  const response = await createHealthHandler({
    loadSnapshot: async () => { throw new Error("DATABASE_URL contains a private password"); },
    getIntegrations: () => ({}),
  })(new Request("https://backend.example/api/health"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, database: "unavailable" });
});

test("health rejects non-GET methods with JSON 405 without reading/writing the DB", async () => {
  const handler = createHealthHandler({
    loadSnapshot: async () => { assert.fail("must not read"); },
    getIntegrations: () => ({}),
  });
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
    const response = await handler(new Request("https://backend.example/api/health", { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("Allow"), "GET");
    assert.deepEqual(await response.json(), { ok: false, error: "method_not_allowed" });
  }
});
