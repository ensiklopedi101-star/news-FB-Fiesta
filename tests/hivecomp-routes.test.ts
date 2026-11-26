import assert from "node:assert/strict";
import { test } from "node:test";
import { createHiveCompPostsHandler, type PublicArticle } from "../src/lib/hivecomp-api";
import { createReadApiRateLimiter } from "../src/lib/read-only-api";

const TOKEN = "unit-test-hivecomp-token-not-a-production-secret";
const APP_URL = "https://backend.example.test";
const article: PublicArticle = {
  id: "7e2b6418-5ea0-4b75-8c1c-68ca80f447c4",
  title: "Judul",
  caption: "Teks postingan",
  imageUrl: null,
  publishedAt: new Date("2026-02-10T08:00:00Z"),
};

type Dependencies = Parameters<typeof createHiveCompPostsHandler>[0];
function createHandler(overrides: Partial<Dependencies> = {}) {
  return createHiveCompPostsHandler({
    getToken: () => TOKEN,
    getAppUrl: () => APP_URL,
    loadPosts: async () => [],
    ...overrides,
  });
}
function request(options: { method?: string; token?: string | null; limit?: string } = {}) {
  const url = new URL(`${APP_URL}/api/pages/popbeez/posts`);
  if (options.limit !== undefined) url.searchParams.set("limit", options.limit);
  return new Request(url, {
    method: options.method ?? "GET",
    headers: options.token === null ? {} : { Authorization: `Bearer ${options.token ?? TOKEN}` },
  });
}
const context = (brand = "popbeez") => ({ params: Promise.resolve({ brand }) });

function assertJson(response: Response) {
  assert.match(response.headers.get("Content-Type") ?? "", /^application\/json\b/);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
}

test("posts GET returns only public fields, UTC time, safe HTTPS picture, and the required cache headers", async () => {
  const handler = createHandler({ loadPosts: async () => [article] });
  const response = await handler(request(), context());
  assert.equal(response.status, 200);
  assertJson(response);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300");
  assert.equal(response.headers.get("Vary"), "Authorization");
  assert.equal(response.headers.get("RateLimit-Limit"), "60");
  assert.deepEqual(await response.json(), {
    items: [{
      id: article.id,
      message: "Teks postingan",
      created_time: "2026-02-10T08:00:00.000Z",
      full_picture: `${APP_URL}/api/og/${article.id}`,
    }],
  });
});

test("empty source returns items as an empty array, not null", async () => {
  const response = await createHandler()(request(), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
});

test("passes the supported brand and a default/clamped limit to a cancellable loader", async () => {
  for (const [raw, expected] of [[undefined, 3], ["99", 3], ["2", 2], ["0", 3], ["bad", 3]] as const) {
    const handler = createHandler({ loadPosts: async (brand, limit, signal) => {
      assert.equal(brand, "nusabeez");
      assert.equal(limit, expected);
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      // Defense in depth: even an overlong loader result cannot exceed the limit.
      return Array.from({ length: 4 }, (_, index) => ({ ...article, id: `post_${index}` }));
    } });
    const response = await handler(request({ limit: raw }), context("nusabeez"));
    const body = await response.json();
    assert.equal(body.items.length, expected);
  }
});

test("401 for missing/wrong token is JSON with an empty items array and never reads the database", async () => {
  let reads = 0;
  const handler = createHandler({ loadPosts: async () => { reads += 1; return []; } });
  for (const token of [null, "wrong-token", "x".repeat(TOKEN.length)]) {
    const response = await handler(request({ token }), context());
    assert.equal(response.status, 401);
    assertJson(response);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("WWW-Authenticate"), 'Bearer realm="hivecomp"');
    assert.deepEqual(await response.json(), { items: [], error: "unauthorized" });
  }
  assert.equal(reads, 0);
});

test("missing backend token fails closed with JSON 500, without reading data", async () => {
  const response = await createHandler({
    getToken: () => undefined,
    loadPosts: async () => { assert.fail("must not read"); },
  })(request(), context());
  assert.equal(response.status, 500);
  assertJson(response);
  assert.deepEqual(await response.json(), { items: [], error: "server_configuration_error" });
});

test("unknown or differently cased brands return JSON 404 without querying data", async () => {
  const handler = createHandler({ loadPosts: async () => { assert.fail("must not read"); } });
  for (const brand of ["unknown", "Popbeez", "news"]) {
    const response = await handler(request(), context(brand));
    assert.equal(response.status, 404);
    assertJson(response);
    assert.deepEqual(await response.json(), { items: [], error: "brand_not_found" });
  }
});

test("all standard non-GET methods return JSON 405 with Allow: GET and no database writes/reads", async () => {
  const handler = createHandler({ loadPosts: async () => { assert.fail("must not read"); } });
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handler(request({ method, token: null }), context());
    assert.equal(response.status, 405);
    assertJson(response);
    assert.equal(response.headers.get("Allow"), "GET");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { items: [], error: "method_not_allowed" });
  }
});

test("429 includes Retry-After and rate headers; unauthorized requests count toward the limit", async () => {
  const handler = createHandler({ rateLimiter: createReadApiRateLimiter(2) });
  assert.equal((await handler(request({ token: "wrong" }), context())).status, 401);
  assert.equal((await handler(request(), context())).status, 200);
  const response = await handler(request(), context());
  assert.equal(response.status, 429);
  assertJson(response);
  assert.equal(response.headers.get("RateLimit-Remaining"), "0");
  assert.equal(response.headers.get("RateLimit-Limit"), "2");
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.ok(Number(response.headers.get("RateLimit-Reset")) <= 60);
  assert.deepEqual(await response.json(), { items: [], error: "too_many_requests" });
});

test("unexpected loader failures return sanitized JSON 500, not an HTML stack or a secret", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = await createHandler({ loadPosts: async () => {
    throw new Error(`postgresql://private@example.test ${TOKEN} +6281234567890`);
  } })(request(), context());
  assert.equal(response.status, 500);
  assertJson(response);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { items: [], error: "internal_server_error" });
});

test("route-param failures are also caught as JSON 500", async (t) => {
  t.mock.method(console, "error", () => {});
  const response = await createHandler()(request(), {
    params: Promise.reject(new Error("private details")),
  });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { items: [], error: "internal_server_error" });
});

test("slow reads are bounded, abort the underlying fetch signal, and return JSON 500", async (t) => {
  t.mock.method(console, "error", () => {});
  let signal: AbortSignal | undefined;
  const handler = createHandler({
    timeoutMs: 20,
    loadPosts: async (_brand, _limit, abortSignal) => {
      signal = abortSignal;
      return new Promise<PublicArticle[]>(() => {});
    },
  });
  const startedAt = performance.now();
  const response = await handler(request(), context());
  assert.equal(response.status, 500);
  assert.ok(performance.now() - startedAt < 2_000);
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await response.json(), { items: [], error: "internal_server_error" });
});
