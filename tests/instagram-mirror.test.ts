import assert from "node:assert/strict";
import test from "node:test";
import { instagramCaption, mirrorEligibility, mirrorImageUrls, mirrorSlideCount } from "../src/lib/instagram-mirror";

const appUrl = "https://portal-beez.vercel.app/";

test("slide counts follow the card format and the manual review", () => {
  assert.equal(mirrorSlideCount({ id: "a", postFormat: "single", sourceName: "Soompi" }), 1);
  assert.equal(mirrorSlideCount({ id: "a", postFormat: "carousel", sourceName: "Soompi" }), 4);
  assert.equal(mirrorSlideCount({ id: "a", postFormat: "carousel", sourceName: "Review manual PopBeez" }), 6);
  assert.equal(mirrorSlideCount({ id: "a", postFormat: "carousel", sourceName: "review manual popbeez" }), 6);
});

test("image URLs reuse the rendered cards, with the slide query only for carousels", () => {
  assert.deepEqual(mirrorImageUrls({ id: "abc", postFormat: "single", sourceName: "Soompi" }, appUrl), ["https://portal-beez.vercel.app/api/og/abc"]);
  const carousel = mirrorImageUrls({ id: "abc", postFormat: "carousel", sourceName: "Soompi" }, appUrl);
  assert.equal(carousel.length, 4);
  assert.equal(carousel[0], "https://portal-beez.vercel.app/api/og/abc?slide=1");
  assert.equal(carousel[3], "https://portal-beez.vercel.app/api/og/abc?slide=4");
  const review = mirrorImageUrls({ id: "abc", postFormat: "carousel", sourceName: "Review manual PopBeez" }, appUrl);
  assert.equal(review.length, 6);
});

test("only posts already live on Facebook qualify, and never twice", () => {
  const published = { status: "published", pageKey: "entertainment", facebookPostId: "1468363823021623_999", instagramMediaId: null };
  assert.equal(mirrorEligibility(published).ok, true);
  assert.equal(mirrorEligibility({ ...published, status: "ready" }).ok, false);
  assert.match(mirrorEligibility({ ...published, status: "ready" }).reason, /Belum tayang/);
  assert.equal(mirrorEligibility({ ...published, facebookPostId: "facebook:pending:abc" }).ok, false);
  assert.equal(mirrorEligibility({ ...published, instagramMediaId: "179123" }).ok, false);
  assert.equal(mirrorEligibility({ ...published, instagramMediaId: "179123" }, { force: true }).ok, true);
});

test("instagram captions are trimmed to the API limit", () => {
  assert.equal(instagramCaption("  Halo Beezers  "), "Halo Beezers");
  assert.equal(instagramCaption(null), "");
  assert.equal(instagramCaption("x".repeat(3_000)).length, 2_200);
});
