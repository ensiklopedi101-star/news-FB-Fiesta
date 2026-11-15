import "server-only";

type GraphResult = { id?: string; post_id?: string; error?: { message?: string; type?: string; code?: number } };

function getGraphBase() {
  const version = process.env.FB_GRAPH_VERSION;
  if (!version || !/^v\d+\.\d+$/.test(version)) {
    throw new Error("FB_GRAPH_VERSION belum diatur dengan format seperti v23.0.");
  }
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !token) throw new Error("FB_PAGE_ID atau FB_PAGE_ACCESS_TOKEN belum diatur.");
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
  imageUrl: string;
  caption: string;
}): Promise<string> {
  const { url, token } = getGraphBase();
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

export async function addSourceComment(postId: string, sourceUrl: string): Promise<void> {
  const { url, token } = getGraphBase();
  await postForm(`${url}/${encodeURIComponent(postId)}/comments`, {
    message: `Sumber berita: ${sourceUrl}`,
    access_token: token,
  });
}
