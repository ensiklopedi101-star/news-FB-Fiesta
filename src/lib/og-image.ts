import { Buffer } from "node:buffer";
import sharp from "sharp";
import { isSafePublicImageUrl } from "./safe-url";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Fetcher = typeof fetch;
type FetchedImage = { bytes: Uint8Array; contentType: string };

async function toJpegBytes(bytes: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(1080, 660, { fit: "cover", position: "centre" })
    .jpeg({ quality: 86 })
    .toBuffer();
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

/** Fetch a safe, bounded raster image from a source or Vercel Blob. */
export async function fetchOgImage(
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  fetcher: Fetcher = fetch,
  reportFailure?: (reason: string) => void,
): Promise<FetchedImage | null> {
  if (!isSafePublicImageUrl(rawImageUrl)) {
    reportFailure?.("URL is not an allowed public HTTPS image URL");
    return null;
  }
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
      reportFailure?.("request failed or timed out");
      return null;
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        reportFailure?.("redirect did not include a destination");
        return null;
      }
      if (redirectCount === MAX_REDIRECTS) {
        reportFailure?.("too many redirects");
        return null;
      }
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        reportFailure?.("redirect destination was malformed");
        return null;
      }
      if (!isSafePublicImageUrl(currentUrl)) {
        reportFailure?.("redirect destination was not an allowed public HTTPS URL");
        return null;
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      reportFailure?.(`image server returned HTTP ${response.status}`);
      return null;
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      reportFailure?.(`unsupported image content type: ${contentType || "missing"}`);
      return null;
    }
    const bytes = await readImage(response);
    if (!bytes?.byteLength) {
      reportFailure?.("image body was empty, unreadable, or exceeded the 5 MB limit");
      return null;
    }
    return { bytes, contentType };
  }
  return null;
}

/** Normalize supported source formats to JPEG bytes for the card compositor or image-only diagnostics. */
export async function fetchOgImageJpeg(
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  fetcher: Fetcher = fetch,
  reportFailure?: (reason: string) => void,
): Promise<Buffer | null> {
  const image = await fetchOgImage(rawImageUrl, sourceUrl, fetcher, reportFailure);
  if (!image) return null;
  try {
    return await toJpegBytes(image.bytes);
  } catch {
    reportFailure?.("image could not be decoded and normalized by Sharp");
    return null;
  }
}

/** Data-URI adapter retained for callers/tests that feed images to next/og. */
export async function fetchOgImageDataUrl(
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  fetcher: Fetcher = fetch,
  reportFailure?: (reason: string) => void,
): Promise<string | null> {
  const normalized = await fetchOgImageJpeg(rawImageUrl, sourceUrl, fetcher, reportFailure);
  return normalized ? `data:image/jpeg;base64,${normalized.toString("base64")}` : null;
}
