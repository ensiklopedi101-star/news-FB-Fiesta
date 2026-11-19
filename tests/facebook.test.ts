import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  FacebookNetworkError,
  getFacebookConfigurationGaps,
  publishFacebookPagePost,
  usesDirectFacebookPublishing,
} from "../src/lib/facebook";

const originalFetch = globalThis.fetch;
const originalEnv = {
  FB_ENTERTAINMENT_PAGE_ID: process.env.FB_ENTERTAINMENT_PAGE_ID,
  FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN: process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN,
  FB_GRAPH_VERSION: process.env.FB_GRAPH_VERSION,
};

function configurePage() {
  process.env.FB_ENTERTAINMENT_PAGE_ID = "1234567890";
  process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN = "page-token-secret";
  process.env.FB_GRAPH_VERSION = "v23.0";
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("publishes a single photo directly to the entertainment page", async () => {
  configurePage();
  const calls: Array<{ url: string; fields: URLSearchParams }> = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), fields: new URLSearchParams(String(init?.body)) });
    return Response.json({ post_id: "1234567890_777" });
  }) as typeof fetch;

  const result = await publishFacebookPagePost({
    pageKey: "entertainment",
    imageUrls: ["https://app.example/api/og/article-1?slide=1"],
    caption: "Halo Popbeez",
  });

  assert.deepEqual(result, { postId: "1234567890_777", mediaFormat: "single" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://graph.facebook.com/v23.0/1234567890/photos");
  assert.equal(calls[0]!.fields.get("published"), "true");
  assert.equal(calls[0]!.fields.get("caption"), "Halo Popbeez");
  assert.equal(calls[0]!.fields.get("access_token"), "page-token-secret");
});

test("uploads carousel slides unpublished then creates one feed post", async () => {
  configurePage();
  const calls: Array<{ url: string; fields: URLSearchParams }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const fields = new URLSearchParams(String(init?.body));
    calls.push({ url, fields });
    if (url.endsWith("/feed")) return Response.json({ id: "1234567890_888" });
    return Response.json({ id: `photo-${calls.length}` });
  }) as typeof fetch;

  const images = ["one", "two", "three"].map((name) => `https://app.example/api/og/article-1?slide=${name}`);
  const result = await publishFacebookPagePost({
    pageKey: "entertainment",
    imageUrls: images,
    caption: "Carousel Popbeez",
  });

  assert.deepEqual(result, { postId: "1234567890_888", mediaFormat: "carousel" });
  assert.equal(calls.length, 4);
  for (const upload of calls.slice(0, 3)) {
    assert.equal(upload.fields.get("published"), "false");
    assert.equal(upload.fields.get("access_token"), "page-token-secret");
  }
  const feed = calls[3]!;
  assert.equal(feed.fields.get("message"), "Carousel Popbeez");
  assert.deepEqual(
    [feed.fields.get("attached_media[0]"), feed.fields.get("attached_media[1]"), feed.fields.get("attached_media[2]")],
    ['{"media_fbid":"photo-1"}', '{"media_fbid":"photo-2"}', '{"media_fbid":"photo-3"}'],
  );
});

test("reports missing entertainment Graph configuration instead of silently publishing", () => {
  delete process.env.FB_ENTERTAINMENT_PAGE_ID;
  delete process.env.FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN;
  assert.deepEqual(getFacebookConfigurationGaps("entertainment"), [
    "FB_ENTERTAINMENT_PAGE_ID",
    "FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN",
  ]);
  assert.equal(usesDirectFacebookPublishing("entertainment"), false);

  configurePage();
  assert.deepEqual(getFacebookConfigurationGaps("entertainment"), []);
  assert.equal(usesDirectFacebookPublishing("entertainment"), true);
  // News never switches to direct publishing, even with entertainment credentials present.
  assert.equal(usesDirectFacebookPublishing("news"), false);
});

test("redacts the page token from Graph API errors and flags network failures", async () => {
  configurePage();
  globalThis.fetch = (async () => Response.json({ error: { message: "Invalid token page-token-secret" } }, { status: 400 })) as typeof fetch;
  await assert.rejects(
    () => publishFacebookPagePost({ pageKey: "entertainment", imageUrls: ["https://images.example/one.jpg"], caption: "x" }),
    (error: Error) => error.message.includes("[REDACTED]") && !error.message.includes("page-token-secret"),
  );

  globalThis.fetch = (async () => { throw new Error("socket hang up"); }) as typeof fetch;
  await assert.rejects(
    () => publishFacebookPagePost({ pageKey: "entertainment", imageUrls: ["https://images.example/one.jpg"], caption: "x" }),
    (error: Error) => error instanceof FacebookNetworkError,
  );
});
