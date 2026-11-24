import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFacebookPostInsights,
  parseFacebookPostSocialStats,
  summarizeFacebookInsights,
  type FacebookInsightsPostInput,
} from "../src/lib/facebook-insights-core";

function post(input: Partial<FacebookInsightsPostInput> & Pick<FacebookInsightsPostInput, "facebookPostId" | "pillar" | "slotLabel">): FacebookInsightsPostInput {
  return {
    title: input.facebookPostId,
    publishedAt: "2026-11-01T12:00:00.000Z",
    syncedAt: "2026-11-10T12:00:00.000Z",
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
});

test("parses comment summary and optional shares separately from post clicks", () => {
  assert.deepEqual(parseFacebookPostSocialStats({
    comments: { summary: { total_count: 12 } },
    shares: { count: 4 },
  }), { comments: 12, shares: 4 });
  assert.deepEqual(parseFacebookPostSocialStats({ comments: { summary: { total_count: "0" } } }), { comments: 0, shares: 0 });
  assert.equal(parseFacebookPostSocialStats({ shares: { count: 5 } }), null);
});

test("aggregates unique posts, compares pillar/slot interaction rates, and requires three samples for a slot signal", () => {
  const summary = summarizeFacebookInsights([
    post({ facebookPostId: "m1", pillar: "manga", slotLabel: "20:30", mediaViews: 140, uniqueViewers: 100, reactions: 10, comments: 2, shares: 1 }),
    post({ facebookPostId: "m2", pillar: "manga", slotLabel: "20:30", mediaViews: 100, uniqueViewers: 100, reactions: 8, comments: 1, shares: 1 }),
    post({ facebookPostId: "m3", pillar: "manga", slotLabel: "20:30", mediaViews: 200, uniqueViewers: 200, reactions: 20, comments: 4, shares: 2 }),
    post({ facebookPostId: "a1", pillar: "analysis", slotLabel: "12:00", mediaViews: 60, uniqueViewers: 50, reactions: 25 }),
    post({ facebookPostId: "partial", pillar: "breaking", slotLabel: "08:30", uniqueViewers: 100, reactions: 50, comments: 30, shares: 20, interactionsAvailable: false }),
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
