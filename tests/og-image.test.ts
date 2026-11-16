import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchOgImageDataUrl } from "../src/lib/og-image";

const pngBytes = new Uint8Array([137, 80, 78, 71]);

test("fetches a safe image with the publisher referer and inlines it as a data URL", async () => {
  let requestedUrl = "";
  let requestedReferer = "";
  const result = await fetchOgImageDataUrl(
    "https://images.example/cover.jpg",
    "https://www.example.com/news/story",
    async (input, init) => {
      requestedUrl = String(input);
      requestedReferer = new Headers(init?.headers).get("referer") ?? "";
      return new Response(pngBytes, { headers: { "content-type": "image/png" } });
    },
  );

  assert.equal(requestedUrl, "https://images.example/cover.jpg");
  assert.equal(requestedReferer, "https://www.example.com/");
  assert.equal(result, `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes))}`);
});

test("follows safe redirects but rejects unsafe redirect destinations", async () => {
  const visited: string[] = [];
  const result = await fetchOgImageDataUrl(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async (input) => {
      const url = String(input);
      visited.push(url);
      if (url.endsWith("cover.jpg")) return new Response(null, { status: 302, headers: { location: "/final.png" } });
      return new Response(pngBytes, { headers: { "content-type": "image/png" } });
    },
  );
  assert.equal(visited[1], "https://images.example/final.png");
  assert.ok(result?.startsWith("data:image/png;base64,"));

  let requestCount = 0;
  const unsafe = await fetchOgImageDataUrl(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async () => {
      requestCount += 1;
      return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
    },
  );
  assert.equal(unsafe, null);
  assert.equal(requestCount, 1);
});

test("rejects HTML responses and images that exceed the byte limit", async () => {
  const html = await fetchOgImageDataUrl(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async () => new Response("blocked", { headers: { "content-type": "text/html" } }),
  );
  assert.equal(html, null);

  const oversized = await fetchOgImageDataUrl(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } }),
  );
  assert.equal(oversized, null);
});
