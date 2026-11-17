import assert from "node:assert/strict";
import test from "node:test";
import { getQueueExpiryCutoff, isQueueItemExpired, MAX_QUEUE_AGE_HOURS } from "../src/lib/queue-policy";

test("queue items expire only after the seven-hour source freshness window", () => {
  const now = new Date("2026-11-17T12:00:00.000Z");
  const cutoff = getQueueExpiryCutoff(now);

  assert.equal(MAX_QUEUE_AGE_HOURS, 7);
  assert.equal(cutoff.toISOString(), "2026-11-17T05:00:00.000Z");
  assert.equal(isQueueItemExpired(cutoff, now), false);
  assert.equal(isQueueItemExpired(new Date(cutoff.getTime() - 1), now), true);
  assert.equal(isQueueItemExpired(new Date(cutoff.getTime() + 1), now), false);
});
