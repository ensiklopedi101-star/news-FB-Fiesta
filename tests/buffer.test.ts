import assert from "node:assert/strict";
import test from "node:test";
import { BufferEnqueueOutcomeUnknownError, checkBufferChannelMapping, enqueueBufferFacebookPost, getBufferConfigurationGaps, listBufferChannels } from "../src/lib/buffer-api";

const ENV_KEYS = ["BUFFER_API_KEY", "BUFFER_NEWS_CHANNEL_ID", "BUFFER_ENTERTAINMENT_CHANNEL_ID"] as const;

async function withBufferEnvironment(run: () => Promise<void>) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.BUFFER_API_KEY = "unit-test-buffer-key";
  process.env.BUFFER_NEWS_CHANNEL_ID = "news-channel-123";
  process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID = "ent-channel-456";
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("queues a Facebook Page image post in Buffer without sending a live request", async () => {
  await withBufferEnvironment(async () => {
    let requestBody: { query: string; variables: { input: Record<string, unknown> } } | undefined;
    let authorization = "";
    globalThis.fetch = (async (input, init) => {
      assert.equal(String(input), "https://api.buffer.com/graphql");
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      requestBody = JSON.parse(String(init?.body)) as typeof requestBody;
      return new Response(JSON.stringify({ data: { createPost: { post: { id: "buffer-post-1" } } } }), { status: 200 });
    }) as typeof fetch;

    const id = await enqueueBufferFacebookPost({
      pageKey: "entertainment",
      imageUrl: "https://news.example.test/api/og/article-1",
      caption: "Caption berita",
      sourceUrl: "https://news.example.test/article-1",
    });

    assert.equal(id, "buffer-post-1");
    assert.equal(authorization, "Bearer unit-test-buffer-key");
    assert.ok(requestBody);
    assert.deepEqual(requestBody.variables.input, {
      channelId: "ent-channel-456",
      mode: "addToQueue",
      schedulingType: "automatic",
      text: "Caption berita",
      assets: [{ image: { url: "https://news.example.test/api/og/article-1" } }],
      metadata: { facebook: { type: "post", firstComment: "Sumber berita: https://news.example.test/article-1" } },
    });
  });
});

test("lists Buffer channels with read-only GraphQL requests", async () => {
  await withBufferEnvironment(async () => {
    let callCount = 0;
    globalThis.fetch = (async (_input, init) => {
      callCount += 1;
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (callCount === 1) {
        assert.match(body.query, /organizations/);
        return new Response(JSON.stringify({ data: { account: { organizations: [{ id: "org-1", name: "News Fiesta" }] } } }), { status: 200 });
      }
      assert.match(body.query, /channels/);
      return new Response(JSON.stringify({ data: { channels: [{ id: "page-1", name: "PopBeez", service: "facebook", type: "page", isDisconnected: false }] } }), { status: 200 });
    }) as typeof fetch;

    const channels = await listBufferChannels();
    assert.equal(callCount, 2);
    assert.deepEqual(channels, [{ id: "page-1", name: "News Fiesta — PopBeez", service: "facebook", type: "page", isDisconnected: false }]);
  });
});

test("reports missing Buffer configuration before the publisher consumes an article", async () => {
  await withBufferEnvironment(async () => {
    delete process.env.BUFFER_NEWS_CHANNEL_ID;
    assert.deepEqual(getBufferConfigurationGaps(["news"]), ["BUFFER_NEWS_CHANNEL_ID"]);
    assert.deepEqual(getBufferConfigurationGaps(["entertainment"]), []);
  });
});

test("validates Buffer channel mappings without publishing", () => {
  const channels = [
    { id: "page-1", name: "PopBeez", service: "facebook", type: "page", isDisconnected: false },
    { id: "group-1", name: "Group", service: "facebook", type: "group", isDisconnected: false },
    { id: "page-offline", name: "Offline Page", service: "facebook", type: "page", isDisconnected: true },
  ];
  assert.deepEqual(checkBufferChannelMapping(undefined, channels), { status: "missing-channel-id" });
  assert.deepEqual(checkBufferChannelMapping("missing", channels), { status: "id-not-found" });
  assert.deepEqual(checkBufferChannelMapping("group-1", channels), { status: "not-a-facebook-page", channelName: "Group" });
  assert.deepEqual(checkBufferChannelMapping("page-offline", channels), { status: "disconnected", channelName: "Offline Page" });
  assert.deepEqual(checkBufferChannelMapping("page-1", channels), { status: "ready", channelName: "PopBeez" });
});

test("marks a Buffer gateway timeout as an unknown enqueue outcome without retrying", async () => {
  await withBufferEnvironment(async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ errors: [{ message: "gateway timeout" }] }), { status: 504 })) as typeof fetch;
    await assert.rejects(
      enqueueBufferFacebookPost({ pageKey: "news", imageUrl: "https://example.test/card.png", caption: "Caption", sourceUrl: "https://example.test/story" }),
      (error: unknown) => {
        assert.ok(error instanceof BufferEnqueueOutcomeUnknownError);
        assert.match(error.message, /hasil enqueue tidak diketahui/);
        assert.match(error.message, /Jangan kirim ulang/);
        assert.doesNotMatch(error.message, /unit-test-buffer-key/);
        return true;
      },
    );
  });
});

test("redacts the Buffer API key from API error text", async () => {
  await withBufferEnvironment(async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: { createPost: { message: "Invalid request; unit-test-buffer-key is sensitive" } } }), { status: 200 })) as typeof fetch;
    await assert.rejects(
      enqueueBufferFacebookPost({ pageKey: "news", imageUrl: "https://example.test/card.png", caption: "Caption", sourceUrl: "https://example.test/story" }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /\[REDACTED\]/);
        assert.doesNotMatch(error.message, /unit-test-buffer-key/);
        return true;
      },
    );
  });
});
