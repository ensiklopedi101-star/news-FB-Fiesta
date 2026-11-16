import { isSafePublicImageUrl } from "./safe-url";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type Fetcher = typeof fetch;
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

/** Fetch a safe, bounded raster image for an Edge-compatible OG renderer. */
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

/** Inline validated image bytes into the OG payload; no Node-only dependencies, so this runs on Edge. */
export async function fetchOgImageDataUrl(
  rawImageUrl: string | null | undefined,
  sourceUrl: string,
  fetcher: Fetcher = fetch,
): Promise<string | null> {
  const image = await fetchOgImage(rawImageUrl, sourceUrl, fetcher);
  return image ? toDataUrl(image.bytes, image.contentType) : null;
}
