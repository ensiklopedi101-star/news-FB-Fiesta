import { Buffer } from "node:buffer";
import type { PageKey } from "@/lib/facebook";

type PhaseResponse = {
  video_id?: string;
  upload_url?: string;
  success?: boolean;
  error?: { message?: string; code?: number };
};

function graphTarget(pageKey: PageKey) {
  const prefix = pageKey === "news" ? "FB_NEWS" : "FB_ENTERTAINMENT";
  const version = process.env.FB_GRAPH_VERSION?.trim() || "v23.0";
  const pageId = process.env[`${prefix}_PAGE_ID`]?.trim() || (pageKey === "news" ? process.env.FB_PAGE_ID?.trim() : undefined);
  const token = process.env[`${prefix}_PAGE_ACCESS_TOKEN`]?.trim() || (pageKey === "news" ? process.env.FB_PAGE_ACCESS_TOKEN?.trim() : undefined);
  if (!pageId || !token) throw new Error(`ID atau Page Access Token untuk halaman ${pageKey} belum diatur.`);
  return { reelsUrl: `https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/video_reels`, token };
}

function errorMessage(data: PhaseResponse, fallback: string) {
  return data.error?.message || fallback;
}

/**
 * Publishes one Reel through the three-phase Reels API:
 * start (get upload_url) → binary upload → finish (PUBLISHED).
 * The Page must have the Reels publishing permission; failures are surfaced as-is.
 */
export async function publishFacebookReel(input: {
  pageKey: PageKey;
  video: Buffer;
  description: string;
}): Promise<{ videoId: string }> {
  const { reelsUrl, token } = graphTarget(input.pageKey);

  const startResponse = await fetch(reelsUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ upload_phase: "start", access_token: token }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const start = await startResponse.json().catch(() => ({})) as PhaseResponse;
  if (!startResponse.ok || !start.video_id || !start.upload_url) {
    throw new Error(`Reels start gagal: ${errorMessage(start, `HTTP ${startResponse.status}`)}`);
  }

  const uploadResponse = await fetch(start.upload_url, {
    method: "POST",
    headers: {
      authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(input.video.length),
      "content-type": "application/octet-stream",
    },
    body: new Uint8Array(input.video),
    signal: AbortSignal.timeout(180_000),
    cache: "no-store",
  });
  const upload = await uploadResponse.json().catch(() => ({})) as PhaseResponse;
  if (!uploadResponse.ok || upload.success === false) {
    throw new Error(`Reels upload gagal: ${errorMessage(upload, `HTTP ${uploadResponse.status}`)}`);
  }

  const finishResponse = await fetch(reelsUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      upload_phase: "finish",
      video_id: start.video_id,
      video_state: "PUBLISHED",
      description: input.description.slice(0, 2_200),
      access_token: token,
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const finish = await finishResponse.json().catch(() => ({})) as PhaseResponse;
  if (!finishResponse.ok || finish.success === false) {
    throw new Error(`Reels finish gagal: ${errorMessage(finish, `HTTP ${finishResponse.status}`)}`);
  }

  return { videoId: start.video_id };
}
