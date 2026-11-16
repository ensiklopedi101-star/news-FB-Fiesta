import assert from "node:assert/strict";
import { test } from "node:test";
import { put } from "@vercel/blob";
import { storeArticleImageInBlob } from "../src/lib/blob-image";

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

test("stores a validated image in public Blob using a deterministic article pathname", async () => {
  let storedPath = "";
  let storedBytes: unknown;
  let storedOptions: unknown;
  const result = await storeArticleImageInBlob(
    "article-1",
    "https://images.example/cover.png",
    "https://www.example.com/story",
    {
      token: "mock-token",
      fetcher: async (input, init) => {
        assert.equal(String(input), "https://images.example/cover.png");
        assert.equal(new Headers(init?.headers).get("referer"), "https://www.example.com/");
        return new Response(pngBytes, { headers: { "content-type": "image/png" } });
      },
      blobWriter: mockBlobWriter((pathname, body, options) => {
        storedPath = pathname;
        storedBytes = body;
        storedOptions = options;
      }),
    },
  );

  assert.equal(result, blobUrl);
  assert.equal(storedPath, "article-images/article-1.png");
  assert.deepEqual(Array.from(storedBytes as Uint8Array), Array.from(pngBytes));
  assert.deepEqual(storedOptions, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/png",
    token: "mock-token",
  });
});

test("does not upload an image already stored in Blob or an unsupported response type", async () => {
  let uploadCount = 0;
  const alreadyStored = await storeArticleImageInBlob(
    "article-1",
    blobUrl,
    "https://www.example.com/story",
    { token: "mock-token", blobWriter: mockBlobWriter(() => { uploadCount += 1; }) },
  );
  assert.equal(alreadyStored, null);
  assert.equal(uploadCount, 0);

  const unsupported = await storeArticleImageInBlob(
    "article-1",
    "https://images.example/cover.avif",
    "https://www.example.com/story",
    {
      token: "mock-token",
      fetcher: async () => new Response(pngBytes, { headers: { "content-type": "image/avif" } }),
      blobWriter: mockBlobWriter(() => { uploadCount += 1; }),
    },
  );
  assert.equal(unsupported, null);
  assert.equal(uploadCount, 0);
});
