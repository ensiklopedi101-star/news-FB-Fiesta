import assert from "node:assert/strict";
import test from "node:test";
import {
  availableFacebookPostMetrics,
  parseFacebookPostInsights,
  parseFacebookPostSocialStats,
  summarizeFacebookInsights,
  type FacebookInsightsPostInput,
} from "../src/lib/facebook-insights-core";

function post(input: Partial<FacebookInsightsPostInput> & Pick<FacebookInsightsPostInput, "facebookPostId" | "pillar" | "slotLabel">): FacebookInsightsPostInput {
  return {
    title: input.facebookPostId,
    segment: "roundup",
    contentFormat: "carousel",
    publishedAt: "2026-11-01T12:00:00.000Z",
    syncedAt: "2026-11-10T12:00:00.000Z",
    availableMetrics: ["mediaViews", "uniqueViewers", "clicks", "reactions", "comments", "shares", "videoViews"],
    mediaViews: 0,
    uniqueViewers: 0,
    clicks: 0,
    reactions: 0,
    comments: 0,
    shares: 0,
    videoViews: 0,
    interactionsAvailable: true,
    ...input,
  };
}

test("parses current Meta media-view metrics and nested reaction totals", () => {
  const metrics = parseFacebookPostInsights({
    data: [
      { name: "post_media_view", values: [{ value: 125 }] },
      { name: "post_total_media_view_unique", values: [{ value: "94" }] },
      { name: "post_clicks", values: [{ value: 7 }] },
      { name: "post_reactions_by_type_total", values: [{ value: { like: 5, love: 2, haha: 1 } }] },
      { name: "post_video_views", values: [{ value: -3 }] },
      { name: "unknown_metric", values: [{ value: 999 }] },
    ],
  });

  assert.deepEqual(metrics, {
    mediaViews: 125,
    uniqueViewers: 94,
    clicks: 7,
    reactions: 8,
    comments: 0,
    shares: 0,
    videoViews: 0,
  });
  assert.deepEqual(availableFacebookPostMetrics({
    data: [
      { name: "post_media_view", values: [{ value: 0 }] },
      { name: "post_reactions_by_type_total", values: [{ value: { like: 0 } }] },
    ],
  }), ["mediaViews", "reactions"], "metrik bernilai nol tetap tersedia bila namanya dikembalikan Meta");
  assert.deepEqual(availableFacebookPostMetrics({
    data: [
      { name: "post_media_view", values: [] },
      { name: "post_clicks", values: [{ value: null }] },
    ],
  }), [], "nama metrik tanpa nilai numerik bukan sampel nol");
});

test("parses comment summary and optional shares separately from post clicks", () => {
  assert.deepEqual(parseFacebookPostSocialStats({
    comments: { summary: { total_count: 12 } },
    shares: { count: 4 },
  }), { comments: 12, shares: 4 });
  assert.deepEqual(parseFacebookPostSocialStats({ comments: { summary: { total_count: "0" } } }), { comments: 0, shares: null }, "field bagikan yang tidak dikembalikan Meta tetap tidak tersedia, bukan nol");
  assert.deepEqual(parseFacebookPostSocialStats({ shares: { count: 5 } }), { comments: null, shares: 5 });
  assert.equal(parseFacebookPostSocialStats({}), null);
});

test("aggregates unique posts, compares pillar/slot interaction rates, and requires three samples for a slot signal", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "m1", pillar: "manga", slotLabel: "20:30", mediaViews: 140, uniqueViewers: 100, reactions: 10, comments: 2, shares: 1 }),
    post({ facebookPostId: "m2", pillar: "manga", slotLabel: "20:30", mediaViews: 100, uniqueViewers: 100, reactions: 8, comments: 1, shares: 1 }),
    post({ facebookPostId: "m3", pillar: "manga", slotLabel: "20:30", mediaViews: 200, uniqueViewers: 200, reactions: 20, comments: 4, shares: 2 }),
    post({ facebookPostId: "a1", pillar: "analysis", slotLabel: "12:00", mediaViews: 60, uniqueViewers: 50, reactions: 25 }),
    post({ facebookPostId: "partial", pillar: "breaking", slotLabel: "08:30", uniqueViewers: 100, reactions: 50, comments: 30, shares: 20, availableMetrics: ["uniqueViewers", "reactions"], interactionsAvailable: false }),
  ], { configured: true });

  assert.equal(summary.postsAnalyzed, 5);
  assert.equal(summary.interactionSamples, 4);
  assert.equal(summary.totalMediaViews, 500);
  assert.equal(summary.totalUniqueViewers, 550);
  assert.equal(summary.totalInteractions, 74);
  assert.equal(summary.totalComments, 7, "partial comments are excluded from the interaction aggregate");
  assert.equal(summary.totalShares, 4);
  assert.equal(summary.totalReactions, 113, "reactions remain available even if the social fields were partial");
  assert.equal(summary.averageInteractionRate, 16.4);
  assert.equal(summary.recommendedSlot, "20:30");
  assert.equal(summary.topSlots.find((slot) => slot.slotLabel === "20:30")?.posts, 3);
  assert.equal(summary.topSlots.find((slot) => slot.slotLabel === "08:30"), undefined);
  assert.equal(summary.topPerformers[0]?.facebookPostId, "m3");
  assert.equal(summary.topSegments[0]?.segment, "roundup");
  assert.equal(summary.topFormats[0]?.contentFormat, "carousel");
  assert.equal(summary.mediaViewSamples, 4);
  assert.equal(summary.uniqueViewerSamples, 5);
});

test("compares separate segment and format dimensions and never infers revenue", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "quiz", pillar: "community", segment: "tebak_drama", contentFormat: "quiz_grid", slotLabel: null, availableMetrics: ["uniqueViewers", "reactions", "comments", "shares"], uniqueViewers: 100, reactions: 10, comments: 2, shares: 1 }),
    post({ facebookPostId: "reel", pillar: "list", segment: "reel", contentFormat: "video", slotLabel: null, mediaViews: 200, uniqueViewers: 100, reactions: 20, comments: 3, shares: 2, videoViews: 180 }),
  ], { configured: true });

  assert.deepEqual(summary.topSegments.map((row) => row.segment).sort(), ["reel", "tebak_drama"]);
  assert.deepEqual(summary.topFormats.map((row) => row.contentFormat).sort(), ["quiz_grid", "video"]);
  assert.equal(summary.totalVideoViews, 180);
  assert.equal(summary.videoViewSamples, 1);
  assert.equal(summary.monetization.available, false);
  assert.match(summary.monetization.note, /tidak ditafsirkan sebagai penghasilan/);
});

test("an absent metric is not displayed as a real zero or included in totals", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "partial", pillar: null, slotLabel: null, availableMetrics: ["reactions"], reactions: 0, interactionsAvailable: false }),
  ], { configured: true });

  assert.equal(summary.postsAnalyzed, 1);
  assert.equal(summary.mediaViewSamples, 0);
  assert.equal(summary.totalMediaViews, 0);
  assert.equal(summary.reactionSamples, 1);
  assert.equal(summary.totalReactions, 0);
  assert.equal(summary.interactionRateSamples, 0);
  assert.equal(summary.averageInteractionRate, null);
});

test("interaction rates only include posts that actually provide unique viewers", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "no-viewers", pillar: "manga", slotLabel: "20:30", segment: "roundup", availableMetrics: ["reactions", "comments", "shares"], reactions: 5, comments: 0, shares: 0 }),
    post({ facebookPostId: "has-viewers", pillar: "manga", slotLabel: "20:30", segment: "roundup", uniqueViewers: 100, reactions: 8, comments: 1, shares: 1 }),
  ], { configured: true });

  const segment = summary.topSegments[0]!;
  assert.equal(segment.posts, 2);
  assert.equal(segment.rateSamples, 1);
  assert.equal(segment.interactions, 15);
  assert.equal(segment.interactionRate, 10, "the 5 interactions with no viewer denominator must not inflate the rate");
  assert.equal(summary.averageInteractionRate, 10);
  assert.equal(summary.topSlots[0]?.rateSamples, 1);
  assert.equal(summary.recommendedSlot, null, "three complete interactions are not enough when fewer than three have unique viewers");
});

test("does not double-count one Facebook post and chooses the newest saved snapshot", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "same-post", pillar: "breaking", slotLabel: "08:30", uniqueViewers: 100, reactions: 10, syncedAt: "2026-11-09T00:00:00.000Z" }),
    post({ facebookPostId: "same-post", pillar: "manga", slotLabel: "20:30", mediaViews: 250, uniqueViewers: 200, reactions: 20, comments: 3, shares: 2, syncedAt: "2026-11-10T00:00:00.000Z" }),
  ], { configured: true });

  assert.equal(summary.postsAnalyzed, 1);
  assert.equal(summary.totalMediaViews, 250);
  assert.equal(summary.totalUniqueViewers, 200);
  assert.equal(summary.totalInteractions, 25);
  assert.equal(summary.topPillars[0]?.pillar, "manga");
  assert.equal(summary.topSlots[0]?.slotLabel, "20:30");
  assert.equal(summary.recommendedSlot, null, "a single sample must never recommend a publishing slot");
});
