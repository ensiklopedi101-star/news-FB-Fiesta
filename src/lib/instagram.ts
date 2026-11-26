import "server-only";
import { getInstagramConfigurationGaps, instagramCredentials, isInstagramPublishingEnabled } from "@/lib/instagram-config";
import {
  InstagramError,
  containerState,
  formatGraphError,
  isMediaNotAvailable,
  publishRetryDelayMs,
  type GraphResponse,
} from "@/lib/instagram-errors";

/**
 * Cross-posting to Instagram. Everything published on the PopBeez Facebook page is
 * mirrored to the Instagram account, using the Instagram Graph API with the same
 * business account that is linked to the page.
 *
 * Requirements on Meta's side: an Instagram **Business/Creator** account linked to
 * the PopBeez page, and a token with `instagram_basic` + `instagram_content_publish`.
 *
 * Publishing is a two-step dance: create a *container*, wait until Meta reports
 * `status_code=FINISHED` for it, then `media_publish`. Skipping the wait is exactly
 * what produces "Media ID is not available" (code 9007).
 */
type InstagramTarget = { userId: string; token: string; version: string };

export { getInstagramConfigurationGaps, isInstagramPublishingEnabled };

const CONTAINER_POLL_INTERVAL_MS = 3_000;
const CONTAINER_POLL_DEADLINE_MS = 45_000;
const PUBLISH_ATTEMPTS = 4;
const REEL_POLL_DEADLINE_MS = 60_000;

function target(): InstagramTarget {
  const gaps = getInstagramConfigurationGaps();
  const credentials = instagramCredentials();
  if (gaps.length || !credentials) throw new Error(`Instagram belum diatur: ${gaps.join(", ")} belum ada.`);
  return {
    ...credentials,
    version: process.env.FB_GRAPH_VERSION?.trim() || "v23.0",
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function postGraph(url: string, fields: Record<string, string>, token: string): Promise<GraphResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, access_token: token }),
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as GraphResponse;
  if (!response.ok || data.error) throw formatGraphError(response.status, data, token);
  return data;
}

async function getGraph(path: string, fields: string, token: string, version: string): Promise<GraphResponse> {
  const response = await fetch(
    `https://graph.facebook.com/${version}/${path}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
    { signal: AbortSignal.timeout(30_000), cache: "no-store" },
  );
  const data = (await response.json().catch(() => ({}))) as GraphResponse;
  if (!response.ok || data.error) throw formatGraphError(response.status, data, token);
  return data;
}

async function createContainer(target: InstagramTarget, fields: Record<string, string>): Promise<string> {
  const data = await postGraph(
    `https://graph.facebook.com/${target.version}/${encodeURIComponent(target.userId)}/media`,
    fields,
    target.token,
  );
  if (!data.id) throw new Error("Instagram tidak mengembalikan ID media.");
  return data.id;
}

/** Waits until Meta finished ingesting the container, then optionally re-checks it. */
export async function waitForContainer(
  containerId: string,
  options: { token?: string; version?: string; userId?: string; timeoutMs?: number } = {},
): Promise<void> {
  const config = options.token && options.version
    ? { token: options.token, version: options.version, userId: options.userId ?? "" }
    : target();
  const deadline = Date.now() + (options.timeoutMs ?? CONTAINER_POLL_DEADLINE_MS);
  let lastStatus = "UNKNOWN";

  while (Date.now() < deadline) {
    let data: GraphResponse;
    try {
      data = await getGraph(encodeURIComponent(containerId), "status_code,status", config.token, config.version);
    } catch (error) {
      // `status_code` is documented for video/carousel containers; some image
      // containers reject the field. In that case just give Meta a moment and let
      // the publish retry (code 9007) do the waiting.
      if (error instanceof InstagramError && error.code === 100) {
        await sleep(2_500);
        return;
      }
      throw error;
    }
    lastStatus = data.status_code ?? "UNKNOWN";
    const state = containerState(lastStatus);
    if (state === "ready") return;
    if (state === "failed") {
      throw new InstagramError(`Instagram menolak memproses media (status ${lastStatus}).`, { code: 9007 });
    }
    await sleep(CONTAINER_POLL_INTERVAL_MS);
  }

  throw new InstagramError(
    `Instagram belum selesai memproses media setelah ${Math.round((options.timeoutMs ?? CONTAINER_POLL_DEADLINE_MS) / 1000)} detik (status ${lastStatus}).`,
    { code: 9007 },
  );
}

async function publishContainer(target: InstagramTarget, creationId: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = await postGraph(
        `https://graph.facebook.com/${target.version}/${encodeURIComponent(target.userId)}/media_publish`,
        { creation_id: creationId },
        target.token,
      );
      if (!data.id) throw new Error("Instagram tidak mengembalikan ID postingan.");
      return data.id;
    } catch (error) {
      // 9007 means "container not ready yet": wait, re-check, try again.
      if (!isMediaNotAvailable(error) || attempt >= PUBLISH_ATTEMPTS - 1) throw error;
      console.warn(`[instagram] media belum siap (percobaan ${attempt + 1}); menunggu lalu mencoba lagi.`);
      await sleep(publishRetryDelayMs(attempt));
      await waitForContainer(creationId, {
        token: target.token,
        version: target.version,
        userId: target.userId,
        timeoutMs: 20_000,
      }).catch(() => undefined);
    }
  }
}

/**
 * Mirrors one feed post (single photo or carousel) to Instagram. Image URLs must be
 * public JPEGs — the same `api/og` cards used for Facebook already are.
 */
export async function publishInstagramPost(input: {
  imageUrls: string[];
  caption: string;
}): Promise<{ mediaId: string; waitedMs: number }> {
  const config = target();
  const images = input.imageUrls.filter(Boolean).slice(0, 10);
  if (!images.length) throw new Error("Tidak ada gambar untuk Instagram.");
  const startedAt = Date.now();

  if (images.length === 1) {
    const container = await createContainer(config, { image_url: images[0]!, caption: input.caption.slice(0, 2_200) });
    await waitForContainer(container, { token: config.token, version: config.version, userId: config.userId });
    return { mediaId: await publishContainer(config, container), waitedMs: Date.now() - startedAt };
  }

  // Carousel: each child must be FINISHED before the parent can reference it.
  // The whole carousel shares one 60 s budget so a slow child cannot eat the
  // pipeline's 120 s request limit.
  const budgetEnd = Date.now() + 60_000;
  const remaining = () => Math.max(8_000, budgetEnd - Date.now());
  const children: string[] = [];
  for (const url of images) {
    const child = await createContainer(config, { image_url: url, is_carousel_item: "true" });
    await waitForContainer(child, { token: config.token, version: config.version, userId: config.userId, timeoutMs: remaining() });
    children.push(child);
  }
  const parent = await createContainer(config, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption: input.caption.slice(0, 2_200),
  });
  await waitForContainer(parent, { token: config.token, version: config.version, userId: config.userId, timeoutMs: remaining() });
  return { mediaId: await publishContainer(config, parent), waitedMs: Date.now() - startedAt };
}

/** Mirrors a Reel. Instagram transcodes the video first, so the container is polled. */
export async function publishInstagramReel(input: {
  videoUrl: string;
  caption: string;
}): Promise<{ mediaId: string; waitedMs: number }> {
  const config = target();
  const startedAt = Date.now();
  const container = await createContainer(config, {
    media_type: "REELS",
    video_url: input.videoUrl,
    caption: input.caption.slice(0, 2_200),
    share_to_feed: "true",
  });
  await waitForContainer(container, {
    token: config.token,
    version: config.version,
    userId: config.userId,
    timeoutMs: REEL_POLL_DEADLINE_MS,
  });
  return { mediaId: await publishContainer(config, container), waitedMs: Date.now() - startedAt };
}
