import assert from "node:assert/strict";
import test from "node:test";
import { PUBLISH_POLICY, publishPolicy } from "../src/lib/schedule";

test("cadence defaults to three posts a day with a four-hour gap", () => {
  assert.equal(PUBLISH_POLICY.maxPerDay, 3);
  assert.equal(PUBLISH_POLICY.maxPerHour, 1);
  assert.equal(PUBLISH_POLICY.minimumGapMinutes, 240);
  assert.deepEqual(publishPolicy({}), {
    maxPerDay: 3,
    maxPerHour: 1,
    minimumGapMinutes: 240,
    harvestEveryHours: 4,
    maxArticlesPerHarvest: 50,
  });
});

test("cadence can be tuned with env without breaking the bounds", () => {
  assert.equal(publishPolicy({ PUBLISH_MAX_PER_DAY: "2" }).maxPerDay, 2);
  assert.equal(publishPolicy({ PUBLISH_MAX_PER_DAY: "0" }).maxPerDay, 1);
  assert.equal(publishPolicy({ PUBLISH_MAX_PER_DAY: "99" }).maxPerDay, 24);
  assert.equal(publishPolicy({ PUBLISH_MIN_GAP_MINUTES: "60" }).minimumGapMinutes, 60);
  assert.equal(publishPolicy({ PUBLISH_MIN_GAP_MINUTES: "abc" }).minimumGapMinutes, 240);
  assert.equal(publishPolicy({ PUBLISH_MAX_PER_HOUR: "3" }).maxPerHour, 3);
});
