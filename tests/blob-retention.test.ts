import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BLOB_RETENTION, pruneReason } from "../src/lib/blob-retention-policy";

const now = new Date("2026-11-20T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

test("reel frame PNGs are pruned a day after rendering", () => {
  assert.equal(pruneReason("reels/abc/frame-0.png", daysAgo(2), DEFAULT_BLOB_RETENTION, now), "frame Reel lebih dari 1 hari");
  assert.equal(pruneReason("reels/abc/frame-0.png", daysAgo(0.2), DEFAULT_BLOB_RETENTION, now), null);
});

test("reel videos and quiz images follow their own windows", () => {
  assert.match(String(pruneReason("reels/abc.mp4", daysAgo(31), DEFAULT_BLOB_RETENTION, now)), /video Reel/);
  assert.equal(pruneReason("reels/abc.mp4", daysAgo(10), DEFAULT_BLOB_RETENTION, now), null);
  assert.match(String(pruneReason("quiz/edition.jpg", daysAgo(60), DEFAULT_BLOB_RETENTION, now)), /gambar kuis/);
  assert.equal(pruneReason("quiz/edition.jpg", daysAgo(5), DEFAULT_BLOB_RETENTION, now), null);
});

test("article photos expire but foreign files are never touched", () => {
  assert.match(String(pruneReason("article-images/abc.jpg", daysAgo(30), DEFAULT_BLOB_RETENTION, now)), /foto artikel/);
  assert.equal(pruneReason("article-images/abc.jpg", daysAgo(3), DEFAULT_BLOB_RETENTION, now), null);
  assert.equal(pruneReason("backups/manual.zip", daysAgo(999), DEFAULT_BLOB_RETENTION, now), null);
});
