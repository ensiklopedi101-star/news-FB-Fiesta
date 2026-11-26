import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { fetchOgImage, fetchOgImageDataUrl, isVercelBlobImageUrl } from "../src/lib/og-image";

const pngBytes = new Uint8Array([137, 80, 78, 71]);

test("normalizes a WebP source to JPEG and sends the publisher referer", async () => {
  const sourcePng = await readFile(new URL("../public/brand/popbeez_icon.png", import.meta.url));
  const sourceWebp = await sharp(sourcePng).webp().toBuffer();
  let requestedUrl = "";
  let requestedReferer = "";
  const result = await fetchOgImageDataUrl(
    "https://images.example/cover.webp",
    "https://www.example.com/news/story",
    async (input, init) => {
      requestedUrl = String(input);
      requestedReferer = new Headers(init?.headers).get("referer") ?? "";
      return new Response(sourceWebp, { headers: { "content-type": "image/webp" } });
    },
  );

  assert.equal(requestedUrl, "https://images.example/cover.webp");
  assert.equal(requestedReferer, "https://www.example.com/");
  assert.ok(result?.startsWith("data:image/jpeg;base64,"));
  assert.deepEqual([...Buffer.from(result!.split(",")[1], "base64").subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test("fetches a Soompi CDN image using its resize query string unchanged", async () => {
  const sourceUrl = "https://6.soompi.io/wp-content/uploads/image/cover.png?s=900x600&e=t";
  let requestedUrl = "";
  const image = await fetchOgImage(sourceUrl, "https://www.soompi.com/article/example", async (input) => {
    requestedUrl = String(input);
    return new Response(pngBytes, { headers: { "content-type": "image/png" } });
  });

  assert.equal(requestedUrl, sourceUrl);
  assert.deepEqual(image?.bytes, pngBytes);
});

test("retries a hotlink-blocked image through the public proxy with browser headers", async () => {
  const visited: string[] = [];
  const image = await fetchOgImage(
    "https://www.dramabeans.com/wp-content/uploads/2026/11/poster.jpg",
    "https://www.dramabeans.com/2026/11/story/",
    async (input, init) => {
      const url = String(input);
      visited.push(url);
      assert.match(new Headers(init?.headers).get("user-agent") ?? "", /Mozilla\/5\.0/);
      if (!url.startsWith("https://images.weserv.nl/")) return new Response(null, { status: 403 });
      return new Response(pngBytes, { headers: { "content-type": "image/jpeg" } });
    },
  );

  assert.deepEqual(image?.bytes, pngBytes);
  assert.equal(visited.length, 2);
  const proxy = new URL(visited[1]!);
  assert.equal(proxy.host, "images.weserv.nl");
  assert.equal(proxy.searchParams.get("url"), "www.dramabeans.com/wp-content/uploads/2026/11/poster.jpg");
});

test("does not proxy a Vercel Blob URL that returns 403", async () => {
  let requestCount = 0;
  const image = await fetchOgImage(
    "https://store.public.blob.vercel-storage.com/article-images/one.jpg",
    "https://www.example.com/story",
    async () => {
      requestCount += 1;
      return new Response(null, { status: 403 });
    },
  );
  assert.equal(image, null);
  assert.equal(requestCount, 1);
});

test("follows safe redirects but rejects unsafe redirect destinations", async () => {
  const visited: string[] = [];
  const result = await fetchOgImage(
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
  assert.deepEqual(result?.bytes, pngBytes);

  let requestCount = 0;
  const unsafe = await fetchOgImage(
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

test("rejects HTML and oversized images; recognizes Vercel Blob URLs", async () => {
  const html = await fetchOgImage(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async () => new Response("blocked", { headers: { "content-type": "text/html" } }),
  );
  assert.equal(html, null);

  const oversized = await fetchOgImage(
    "https://images.example/cover.jpg",
    "https://www.example.com/story",
    async () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } }),
  );
  assert.equal(oversized, null);
  assert.equal(isVercelBlobImageUrl("https://store.public.blob.vercel-storage.com/article-images/one.jpg"), true);
  assert.equal(isVercelBlobImageUrl("http://store.public.blob.vercel-storage.com/article-images/one.jpg"), false);
});
