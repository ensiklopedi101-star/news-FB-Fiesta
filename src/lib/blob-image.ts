import { Buffer } from "node:buffer";
import { put } from "@vercel/blob";
import { fetchOgImage, isVercelBlobImageUrl } from "./og-image";

type BlobWriter = typeof put;

/** Upload a validated source image to Blob from a Node.js route/harvest worker. */
export async function storeArticleImageInBlob(
  articleId: string,
  imageUrl: string | null | undefined,
  sourceUrl: string,
  options: { fetcher?: typeof fetch; blobWriter?: BlobWriter; token?: string } = {},
): Promise<string | null> {
  if (!imageUrl || isVercelBlobImageUrl(imageUrl)) return null;

  const token = options.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn(`[og-image] BLOB_READ_WRITE_TOKEN is missing for article ${articleId}; source image is not persisted.`);
    return null;
  }

  const image = await fetchOgImage(imageUrl, sourceUrl, options.fetcher);
  if (!image) {
    console.warn(`[og-image] Source image could not be fetched or was rejected for article ${articleId}.`);
    return null;
  }

  const extension = image.contentType === "image/jpeg" ? "jpg" : image.contentType.slice("image/".length);
  try {
    const blob = await (options.blobWriter ?? put)(`article-images/${articleId}.${extension}`, Buffer.from(image.bytes), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: image.contentType,
      token,
    });
    return blob.url;
  } catch {
    console.error(`[og-image] Blob upload failed for article ${articleId}; source image URL was retained.`);
    return null;
  }
}
