import assert from "node:assert/strict";
import test from "node:test";
import { getInstagramConfigurationGaps, instagramCredentials, isInstagramPublishingEnabled } from "../src/lib/instagram-config";

test("reports missing Instagram credentials instead of failing silently", () => {
  assert.deepEqual(getInstagramConfigurationGaps({}), ["IG_USER_ID", "IG_ACCESS_TOKEN"]);
  assert.equal(isInstagramPublishingEnabled({}), false);
  assert.equal(instagramCredentials({}), null);
});

test("accepts the page token as the Instagram token when the account is linked", () => {
  assert.equal(isInstagramPublishingEnabled({ IG_USER_ID: "1784", FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN: "token" }), true);
  assert.deepEqual(getInstagramConfigurationGaps({ IG_USER_ID: "1784" }), ["IG_ACCESS_TOKEN"]);
  assert.deepEqual(instagramCredentials({ IG_USER_ID: "1784", IG_ACCESS_TOKEN: "t" }), { userId: "1784", token: "t" });
});
