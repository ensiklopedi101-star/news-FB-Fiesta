import "server-only";
import { getInstagramConfigurationGaps, instagramCredentials, isInstagramPublishingEnabled } from "@/lib/instagram-config";

/**
 * Cross-posting to Instagram. Everything published on the PopBeez Facebook page is
 * mirrored to the Instagram account, using the Instagram Graph API with the same
 * business account that is linked to the page.
 *
 * Requirements on Meta's side: an Instagram **Business/Creator** account linked to
 * the PopBeez page, and a token with `instagram_basic` + `instagram_content_publish`.
 */
type InstagramTarget = { userId: string; token: string; version: string };

export { getInstagramConfigurationGaps, isInstagramPublishingEnabled };

function target(): InstagramTarget {
  const gaps = getInstagramConfigurationGaps();
  const credentials = instagramCredentials();
  if (gaps.length || !credentials) throw new Error(`Instagram belum diatur: ${gaps.join(", ")} belum ada.`);
  return {
    ...credentials,
    version: process.env.FB_GRAPH_VERSION?.trim() || "v23.0",
  };
}

type GraphAnswer = { id?: string; status_code?: string; error?: { message?: string } };

async function callGraph(url: string, fields: Record<string, string>, token: string): Promise<GraphAnswer> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: token }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as GraphAnswer;
  if (!response.ok || data.error) {
    const detail = (data.error?.message || `HTTP ${response.status}`).split(token).join("[REDACTED]");
    throw new Error(`Instagram Graph API: ${detail.slice(0, 400)}`);
  }
  return data;
}

async function createContainer(target: InstagramTarget, fields: Record<string, string>): Promise<string> {
  const data = await callGraph(`https://graph.facebook.com/${target.version}/${encodeURIComponent(target.userId)}/media`, fields, target.token);
  if (!data.id) throw new Error("Instagram tidak mengembalikan ID media.");
  return data.id;
}

async function publishContainer(target: InstagramTarget, creationId: string): Promise<string> {
  const data = await callGraph(`https://graph.facebook.com/${target.version}/${encodeURIComponent(target.userId)}/media_publish`, { creation_id: creationId }, target.token);
  if (!data.id) throw new Error("Instagram tidak mengembalikan ID postingan.");
  return data.id;
}

/**
 * Mirrors one feed post (single photo or carousel) to Instagram. Image URLs must be
 * public JPEGs — the same `api/og` cards used for Facebook already are.
 */
export async function publishInstagramPost(input: {
  imageUrls: string[];
  caption: string;
}): Promise<{ mediaId: string }> {
  const config = target();
  const images = input.imageUrls.filter(Boolean).slice(0, 10);
  if (!images.length) throw new Error("Tidak ada gambar untuk Instagram.");

  if (images.length === 1) {
    const container = await createContainer(config, {
      image_url: images[0]!,
      caption: input.caption.slice(0, 2_200),
    });
    return { mediaId: await publishContainer(config, container) };
  }

  // Carousel: children first, then a parent container that carries the caption.
  const children: string[] = [];
  for (const url of images) {
    children.push(await createContainer(config, { image_url: url, is_carousel_item: "true" }));
  }
  const parent = await createContainer(config, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: input.caption.slice(0, 2_200),
  });
  return { mediaId: await publishContainer(config, parent) };
}

const REEL_POLL_INTERVAL_MS = 4_000;
const REEL_POLL_ATTEMPTS = 15;

/** Mirrors a Reel. Instagram processes the video first, so the container is polled. */
export async function publishInstagramReel(input: {
  videoUrl: string;
  caption: string;
}): Promise<{ mediaId: string }> {
  const config = target();
  const container = await createContainer(config, {
    media_type: "REELS",
    video_url: input.videoUrl,
    caption: input.caption.slice(0, 2_200),
    share_to_feed: "true",
  });

  for (let attempt = 0; attempt < REEL_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetch(
      `https://graph.facebook.com/${config.version}/${encodeURIComponent(container)}?fields=status_code&access_token=${encodeURIComponent(config.token)}`,
      { signal: AbortSignal.timeout(20_000), cache: "no-store" },
    );
    const data = (await response.json().catch(() => ({}))) as GraphAnswer;
    if (data.status_code === "FINISHED") return { mediaId: await publishContainer(config, container) };
    if (data.status_code === "ERROR") throw new Error("Instagram gagal memproses video Reel.");
    await new Promise((resolve) => setTimeout(resolve, REEL_POLL_INTERVAL_MS));
  }
  throw new Error("Instagram belum selesai memproses video Reel; coba lagi nanti.");
}
