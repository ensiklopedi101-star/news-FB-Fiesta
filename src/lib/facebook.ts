export type PageKey = "news" | "entertainment";

type GraphResult = { id?: string; post_id?: string; error?: { message?: string; type?: string; code?: number } };

/** The Graph request may have reached Facebook before the connection failed. */
export class FacebookNetworkError extends Error {}
/** The feed post may exist even though Facebook did not return a usable response. */
export class FacebookPublishOutcomeUnknownError extends Error {}

function pagePrefix(pageKey: PageKey) {
  return pageKey === "news" ? "FB_NEWS" : "FB_ENTERTAINMENT";
}

function graphVersion() {
  const configured = process.env.FB_GRAPH_VERSION?.trim();
  if (!configured) return "v23.0";
  if (!/^v\d+\.\d+$/.test(configured)) throw new Error("FB_GRAPH_VERSION harus berformat seperti v23.0.");
  return configured;
}

function pageIdFor(pageKey: PageKey) {
  const prefix = pagePrefix(pageKey);
  return process.env[`${prefix}_PAGE_ID`]?.trim() || (pageKey === "news" ? process.env.FB_PAGE_ID?.trim() : undefined);
}

function pageTokenFor(pageKey: PageKey) {
  const prefix = pagePrefix(pageKey);
  return process.env[`${prefix}_PAGE_ACCESS_TOKEN`]?.trim() || (pageKey === "news" ? process.env.FB_PAGE_ACCESS_TOKEN?.trim() : undefined);
}

/** List the environment variables that still block direct Graph API publishing for a page. */
export function getFacebookConfigurationGaps(pageKey: PageKey): string[] {
  const prefix = pagePrefix(pageKey);
  const missing: string[] = [];
  if (!pageIdFor(pageKey)) missing.push(`${prefix}_PAGE_ID`);
  if (!pageTokenFor(pageKey)) missing.push(`${prefix}_PAGE_ACCESS_TOKEN`);
  try {
    graphVersion();
  } catch {
    missing.push("FB_GRAPH_VERSION");
  }
  return missing;
}

export function isFacebookPublishingEnabled(pageKey: PageKey): boolean {
  return getFacebookConfigurationGaps(pageKey).length === 0;
}

/** Entertainment (Popbeez) publishes directly once its Graph credentials exist. */
export function usesDirectFacebookPublishing(pageKey: PageKey): boolean {
  return pageKey === "entertainment" && isFacebookPublishingEnabled(pageKey);
}

/**
 * `root` is the versioned Graph root; `url` is the page-scoped node used for
 * publishing. Object ids returned by Facebook (for example `1234567890_777`)
 * already carry the page prefix, so they must be addressed from `root` and not
 * appended to `url` — that produced `/<pageId>/<pageId>_<postId>/comments`
 * and Graph answered "Unknown path components".
 */
function getGraphConfig(pageKey: PageKey) {
  const version = graphVersion();
  const pageId = pageIdFor(pageKey);
  const token = pageTokenFor(pageKey);
  if (!pageId || !token) throw new Error(`ID atau Page Access Token untuk halaman ${pageKey} belum diatur.`);
  const root = `https://graph.facebook.com/${version}`;
  return { root, url: `${root}/${encodeURIComponent(pageId)}`, token };
}

function redact(message: string, token: string) {
  return message.split(token).join("[REDACTED]").slice(0, 500);
}

async function postForm(url: string, fields: Record<string, string>, token: string): Promise<GraphResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new FacebookNetworkError("Koneksi ke Facebook Graph API gagal atau timeout.");
  }
  let data: GraphResult;
  try {
    data = await response.json() as GraphResult;
  } catch {
    throw new FacebookNetworkError(`Facebook Graph API mengembalikan respons yang tidak bisa dibaca (HTTP ${response.status}).`);
  }
  if (!response.ok || data.error) {
    const detail = data.error?.message || `Graph API HTTP ${response.status}`;
    throw new Error(`Facebook Graph API: ${redact(detail, token)}`);
  }
  return data;
}

/** Publish one photo or a multi-photo (carousel) post straight to the page. */
export async function publishFacebookPagePost(input: {
  pageKey: PageKey;
  imageUrls: string[];
  caption: string;
}): Promise<{ postId: string; mediaFormat: "single" | "carousel" }> {
  const { url, token } = getGraphConfig(input.pageKey);
  const imageUrls = input.imageUrls.filter(Boolean);
  if (!imageUrls.length) throw new Error("Tidak ada gambar untuk diterbitkan ke Facebook.");

  if (imageUrls.length === 1) {
    const result = await postForm(`${url}/photos`, {
      url: imageUrls[0]!,
      caption: input.caption,
      published: "true",
      access_token: token,
    }, token);
    const postId = result.post_id || result.id;
    if (!postId) throw new Error("Facebook tidak mengembalikan ID postingan.");
    return { postId, mediaFormat: "single" };
  }

  // Multi-photo feed posts require each photo to be uploaded unpublished first.
  const mediaIds = await Promise.all(imageUrls.map(async (imageUrl) => {
    const result = await postForm(`${url}/photos`, {
      url: imageUrl,
      published: "false",
      access_token: token,
    }, token);
    if (!result.id) throw new Error("Facebook tidak mengembalikan ID foto.");
    return result.id;
  }));

  const fields: Record<string, string> = { message: input.caption, access_token: token };
  mediaIds.forEach((mediaId, index) => {
    fields[`attached_media[${index}]`] = JSON.stringify({ media_fbid: mediaId });
  });
  let feed: GraphResult;
  try {
    feed = await postForm(`${url}/feed`, fields, token);
  } catch (error) {
    if (error instanceof FacebookNetworkError) {
      throw new FacebookPublishOutcomeUnknownError(`${error.message} Posting carousel mungkin sudah dibuat; periksa halaman Facebook sebelum mengirim ulang.`);
    }
    throw error;
  }
  if (!feed.id) throw new Error("Facebook tidak mengembalikan ID postingan.");
  return { postId: feed.id, mediaFormat: "carousel" };
}

export async function createFacebookPhotoPost(input: {
  pageKey: PageKey;
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const result = await publishFacebookPagePost({ pageKey: input.pageKey, imageUrls: [input.imageUrl], caption: input.caption });
  return result.postId;
}

export async function addPageComment(pageKey: PageKey, postId: string, message: string): Promise<void> {
  const { root, token } = getGraphConfig(pageKey);
  const objectId = postId.trim();
  if (!objectId) throw new Error("ID postingan Facebook kosong; komentar tidak bisa dikirim.");
  await postForm(`${root}/${encodeURIComponent(objectId)}/comments`, {
    message,
    access_token: token,
  }, token);
}

export async function addSourceComment(pageKey: PageKey, postId: string, sourceUrl: string): Promise<void> {
  await addPageComment(pageKey, postId, `🔗 Sumber: ${sourceUrl}`);
}
