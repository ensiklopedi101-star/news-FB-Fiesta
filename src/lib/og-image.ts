import { Buffer } from "node:buffer";
import { put } from "@vercel/blob";
import { isSafePublicImageUrl } from "./safe-url";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Fetcher = typeof fetch;
type BlobWriter = typeof put;

type FetchedImage = { bytes: Uint8Array; contentType: string };

function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

async function readImage(response: Response): Promise<Uint8Array | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function isVercelBlobImageUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.endsWith(".public.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

/** Fetch a safe, bounded raster image and return its bytes for the OG renderer/storage. */
export async function fetchOgImage(
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  fetcher: Fetcher = fetch,
): Promise<FetchedImage | null> {
  if (!isSafePublicImageUrl(rawImageUrl)) return null;
  let currentUrl = rawImageUrl;
  let referer: string | undefined;
  try {
    const source = new URL(sourceUrl);
    if (source.protocol === "https:") referer = `${source.origin}/`;
  } catch {
    // A missing or malformed source URL should not prevent attempting the image.
  }

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        redirect: "manual",
        headers: {
          accept: "image/jpeg,image/png,image/webp",
          ...(referer ? { referer } : {}),
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
    } catch {
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirectCount === MAX_REDIRECTS) return null;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      if (!isSafePublicImageUrl(currentUrl)) return null;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    const bytes = await readImage(response);
    if (!bytes?.byteLength) return null;
    return { bytes, contentType };
  }
  return null;
}

/** Store a fetched image in public Vercel Blob; still render it if storage is not configured/available. */
export async function fetchAndStoreOgImage(
  articleId: string,
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  options: { fetcher?: Fetcher; blobWriter?: BlobWriter; token?: string } = {},
): Promise<{ dataUrl: string; blobUrl: string | null } | null> {
  const image = await fetchOgImage(rawImageUrl, sourceUrl, options.fetcher);
  if (!image) return null;

  let blobUrl: string | null = null;
  const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!isVercelBlobImageUrl(rawImageUrl) && !token) {
    console.warn(`[og-image] BLOB_READ_WRITE_TOKEN is missing for article ${articleId}; image is rendered but not persisted.`);
  }
  if (token && !isVercelBlobImageUrl(rawImageUrl)) {
    const extension = image.contentType === "image/jpeg" ? "jpg" : image.contentType.slice("image/".length);
    try {
      const blob = await (options.blobWriter ?? put)(`article-images/${articleId}.${extension}`, Buffer.from(image.bytes), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: image.contentType,
        token,
      });
      blobUrl = blob.url;
    } catch {
      console.error(`[og-image] Blob upload failed for article ${articleId}; image is rendered but not persisted.`);
    }
  }

  return { dataUrl: toDataUrl(image.bytes, image.contentType), blobUrl };
}
