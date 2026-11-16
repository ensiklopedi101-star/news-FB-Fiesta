import "server-only";

export type PageKey = "news" | "entertainment";

type GraphResult = { id?: string; post_id?: string; error?: { message?: string; type?: string; code?: number } };

function getGraphBase(pageKey: PageKey) {
  const version = process.env.FB_GRAPH_VERSION;
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new Error("FB_GRAPH_VERSION belum diatur dengan format seperti v23.0.");
  }
  const prefix = pageKey === "news" ? "FB_NEWS" : "FB_ENTERTAINMENT";
  const pageId = process.env[`${prefix}_PAGE_ID`] || (pageKey === "news" ? process.env.FB_PAGE_ID : undefined);
  const token = process.env[`${prefix}_PAGE_ACCESS_TOKEN`] || (pageKey === "news" ? process.env.FB_PAGE_ACCESS_TOKEN : undefined);
  if (!pageId || !token) throw new Error(`ID atau Page Access Token untuk halaman ${pageKey} belum diatur.`);
  return { url: `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}`, token };
}

async function postForm(url: string, fields: Record<string, string>): Promise<GraphResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const data = await response.json() as GraphResult;
  if (!response.ok || data.error) {
    const detail = data.error?.message || `Graph API HTTP ${response.status}`;
    throw new Error(`Facebook Graph API: ${detail}`);
  }
  return data;
}

export async function createFacebookPhotoPost(input: {
  pageKey: PageKey;
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const { url, token } = getGraphBase(input.pageKey);
  const result = await postForm(`${url}/photos`, {
    url: input.imageUrl,
    caption: input.caption,
    published: "true",
    access_token: token,
  });
  const postId = result.post_id || result.id;
  if (!postId) throw new Error("Facebook tidak mengembalikan ID postingan.");
  return postId;
}

export async function addSourceComment(pageKey: PageKey, postId: string, sourceUrl: string): Promise<void> {
  const { url, token } = getGraphBase(pageKey);
  await postForm(`${url}/${encodeURIComponent(postId)}/comments`, {
    message: `Sumber berita: ${sourceUrl}`,
    access_token: token,
  });
}
