import assert from "node:assert/strict";
import test from "node:test";
import { assessAutomationHealth, shouldAutoHarvestBeforePublish } from "../src/lib/automation-health";

test("shouldAutoHarvestBeforePublish triggers when feeds were never fetched or are older than 4 hours", () => {
  const now = new Date("2026-11-16T08:30:00.000Z");

  const neverFetched = shouldAutoHarvestBeforePublish({
    now,
    activeFeedCount: 4,
    lastFeedFetchedAt: null,
    imageEligibleEntertainment: 0,
    entertainmentConfigured: true,
  });
  assert.deepEqual(neverFetched, { shouldHarvest: true, reason: "feed-never-fetched" });

  const stale = shouldAutoHarvestBeforePublish({
    now,
    activeFeedCount: 4,
    lastFeedFetchedAt: new Date(now.getTime() - 4.2 * 60 * 60 * 1000),
    imageEligibleEntertainment: 6,
    entertainmentConfigured: true,
  });
  assert.deepEqual(stale, { shouldHarvest: true, reason: "feed-stale" });
});

test("shouldAutoHarvestBeforePublish refills entertainment roundup queue after 45m when <4 images are ready", () => {
  const now = new Date("2026-11-16T08:30:00.000Z");

  const lowQueue = shouldAutoHarvestBeforePublish({
    now,
    activeFeedCount: 4,
    lastFeedFetchedAt: new Date(now.getTime() - 50 * 60 * 1000),
    imageEligibleEntertainment: 2,
    entertainmentConfigured: true,
  });
  assert.deepEqual(lowQueue, { shouldHarvest: true, reason: "roundup-needs-candidates" });

  const healthyQueue = shouldAutoHarvestBeforePublish({
    now,
    activeFeedCount: 4,
    lastFeedFetchedAt: new Date(now.getTime() - 90 * 60 * 1000),
    imageEligibleEntertainment: 5,
    entertainmentConfigured: true,
  });
  assert.deepEqual(healthyQueue, { shouldHarvest: false, reason: null });
});

test("assessAutomationHealth pinpoints a 17-hour publishing stall and stale RSS", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  const report = assessAutomationHealth({
    now,
    activeFeedCount: 5,
    failingFeedCount: 1,
    lastFeedFetchedAt: new Date(now.getTime() - 17 * 60 * 60 * 1000),
    lastCronAt: new Date(now.getTime() - 180 * 60 * 1000),
    lastCronOutcome: "outside-slot",
    lastHarvestAt: null,
    lastPublishedAt: new Date(now.getTime() - 17 * 60 * 60 * 1000),
    queuedTotal: 0,
    queuedEntertainment: 0,
    imageEligibleEntertainment: 0,
    failedArticlesLast24h: 2,
    recentAutomationErrors: 1,
    publisherLockedUntil: null,
    appUrlHost: "portal-beez.vercel.app",
    shortlinkOnlyHost: "popbeez.hivecomp.my.id",
  });

  assert.equal(report.level, "critical");
  assert.equal(report.hoursSinceLastPublish, 17);
  const codes = report.issues.map((issue) => issue.code);
  assert.ok(codes.includes("rss-stale"));
  assert.ok(codes.includes("cron-missing"));
  assert.ok(codes.includes("publish-stalled"));
  assert.ok(codes.includes("feeds-failing"));
  assert.ok(codes.includes("articles-failed"));
});

test("assessAutomationHealth flags shortlink domain conflict and reports healthy when all signals are fresh", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");

  const conflict = assessAutomationHealth({
    now,
    activeFeedCount: 5,
    failingFeedCount: 0,
    lastFeedFetchedAt: new Date(now.getTime() - 30 * 60 * 1000),
    lastCronAt: new Date(now.getTime() - 10 * 60 * 1000),
    lastCronOutcome: "ok",
    lastHarvestAt: new Date(now.getTime() - 30 * 60 * 1000),
    lastPublishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    queuedTotal: 6,
    queuedEntertainment: 6,
    imageEligibleEntertainment: 5,
    failedArticlesLast24h: 0,
    recentAutomationErrors: 0,
    publisherLockedUntil: null,
    appUrlHost: "popbeez.hivecomp.my.id",
    shortlinkOnlyHost: "popbeez.hivecomp.my.id",
  });
  assert.equal(conflict.level, "critical");
  assert.equal(conflict.issues[0]?.code, "shortlink-host-conflict");

  const healthy = assessAutomationHealth({
    now,
    activeFeedCount: 5,
    failingFeedCount: 0,
    lastFeedFetchedAt: new Date(now.getTime() - 30 * 60 * 1000),
    lastCronAt: new Date(now.getTime() - 10 * 60 * 1000),
    lastCronOutcome: "ok",
    lastHarvestAt: new Date(now.getTime() - 30 * 60 * 1000),
    lastPublishedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    queuedTotal: 6,
    queuedEntertainment: 6,
    imageEligibleEntertainment: 5,
    failedArticlesLast24h: 0,
    recentAutomationErrors: 0,
    publisherLockedUntil: null,
    appUrlHost: "portal-beez.vercel.app",
    shortlinkOnlyHost: "popbeez.hivecomp.my.id",
  });
  assert.equal(healthy.level, "healthy");
  assert.equal(healthy.issues.length, 0);
});
