import assert from "node:assert/strict";
import { test } from "node:test";
import { put } from "@vercel/blob";
import { fetchAndStoreOgImage, fetchOgImage, isVercelBlobImageUrl } from "../src/lib/og-image";

const pngBytes = new Uint8Array([137, 80, 78, 71]);
const blobUrl = "https://store.public.blob.vercel-storage.com/article-images/article-1.png";

const mockBlobWriter = (onPut: (pathname: string, body: unknown, options: unknown) => void = () => undefined) => (async (
  pathname: string,
  body: unknown,
  options: unknown,
) => {
  onPut(pathname, body, options);
  return { url: blobUrl };
}) as unknown as typeof put;

test("fetches the source with its publisher referer, stores the bytes in Blob, and returns an inline image", async () => {
  let requestedUrl = "";
  let requestedReferer = "";
  let storedPath = "";
  let storedBytes: unknown;
  let storedOptions: unknown;

  const result = await fetchAndStoreOgImage(
    "article-1",
    "https://images.example/cover.jpg",
    "https://www.example.com/news/story",
    {
      token: "mock-token",
      fetcher: async (input, init) => {
        requestedUrl = String(input);
        requestedReferer = new Headers(init?.headers).get("referer") ?? "";
        return new Response(pngBytes, { headers: { "content-type": "image/png" } });
      },
      blobWriter: mockBlobWriter((pathname, body, options) => {
        storedPath = pathname;
        storedBytes = body;
        storedOptions = options;
      }),
    },
  );

  assert.equal(requestedUrl, "https://images.example/cover.jpg");
  assert.equal(requestedReferer, "https://www.example.com/");
  assert.equal(storedPath, "article-images/article-1.png");
  assert.deepEqual(Array.from(storedBytes as Uint8Array), Array.from(pngBytes));
  assert.deepEqual(storedOptions, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/png",
    token: "mock-token",
  });
  assert.equal(result?.blobUrl, blobUrl);
  assert.equal(result?.dataUrl, `data:image/png;base64,${btoa(String.fromCharCode(...pngBytes))}`);
});

test("follows safe redirects and rejects unsafe redirect destinations", async () => {
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

test("rejects HTML and oversized files and does not re-upload images already on Blob", async () => {
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

  let uploadCount = 0;
  const alreadyStored = await fetchAndStoreOgImage(
    "article-1",
    blobUrl,
    "https://www.example.com/story",
    {
      token: "mock-token",
      fetcher: async () => new Response(pngBytes, { headers: { "content-type": "image/png" } }),
      blobWriter: mockBlobWriter(() => { uploadCount += 1; }),
    },
  );
  assert.equal(isVercelBlobImageUrl(blobUrl), true);
  assert.equal(alreadyStored?.blobUrl, null);
  assert.equal(uploadCount, 0);
});
