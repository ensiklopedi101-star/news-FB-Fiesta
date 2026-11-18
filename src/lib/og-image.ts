import { Buffer } from "node:buffer";
import sharp from "sharp";
import { isSafePublicImageUrl } from "./safe-url";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Fetcher = typeof fetch;
type FetchedImage = { bytes: Uint8Array; contentType: string };

// Public image CDNs often reject default Node.js requests and Facebook-style Referers.
const IMAGE_REQUEST_HEADERS = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,id;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function imageHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return "unknown host";
  }
}

/**
 * Last-resort public image proxy for publishers that reject datacenter requests with 401/403.
 * The source URL is validated before it is handed to the proxy.
 */
function proxiedImageUrl(raw: string): string | null {
  if (!isSafePublicImageUrl(raw)) return null;
  try {
    const source = new URL(raw);
    const target = `${source.host}${source.pathname}${source.search}`;
    return `https://images.weserv.nl/?url=${encodeURIComponent(target)}&output=jpg&q=88&w=1080`;
  } catch {
    return null;
  }
}

async function toJpegBytes(bytes: Uint8Array): Promise<Buffer> {
  return sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
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
  const sourceHost = imageHost(rawImageUrl);
  let viaProxy = false;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetcher(currentUrl, {
        redirect: "manual",
        headers: {
          ...IMAGE_REQUEST_HEADERS,
          ...(referer && !viaProxy ? { referer } : {}),
        },
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
    } catch {
      reportFailure?.(`request failed or timed out for ${sourceHost}`);
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
      // A hotlink block is the most common failure; retry once through a public proxy.
      if ((response.status === 401 || response.status === 403) && !viaProxy && !isVercelBlobImageUrl(currentUrl)) {
        const proxied = proxiedImageUrl(currentUrl);
        if (proxied) {
          viaProxy = true;
          currentUrl = proxied;
          continue;
        }
      }
      reportFailure?.(`image server returned HTTP ${response.status} for ${sourceHost}`);
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
