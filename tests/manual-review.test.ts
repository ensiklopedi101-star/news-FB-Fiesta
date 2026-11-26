import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManualReviewCaption, createManualReview, MANUAL_REVIEW_FOLLOW_COMMENT, manualImageReferer, parseManualReview } from "../src/lib/manual-review";

const sample = {
  headline: "5 Drama Rating Tertinggi Minggu Ini",
  mediaType: "DRAMA",
  items: [
    { title: "Drama B", rating: 8.2, genre: "Komedi", imageUrl: "https://images.example.test/b.jpg" },
    { title: "Drama D", rating: 9.1, genre: "Aksi", imageUrl: "https://images.example.test/d.jpg" },
    { title: "Drama A", rating: 9.7, genre: "Romansa", imageUrl: "https://images.example.test/a.jpg" },
    { title: "Drama C", rating: 8.8, genre: "Fantasi", imageUrl: "https://images.example.test/c.jpg" },
    { title: "Drama E", rating: 8.5, genre: "Misteri", imageUrl: "https://images.example.test/e.jpg" },
  ],
};

test("sorts manual review entries by descending rating and persists the same order", () => {
  const review = createManualReview(sample);
  assert.deepEqual(review.items.map((item) => item.title), ["Drama A", "Drama D", "Drama C", "Drama E", "Drama B"]);
  assert.deepEqual(parseManualReview(JSON.stringify(review))?.items.map((item) => item.title), review.items.map((item) => item.title));
});

test("manual review caption keeps numbered winners without external links", () => {
  const caption = buildManualReviewCaption(createManualReview(sample));
  assert.match(caption, /1️⃣ JUARA MINGGU INI: Drama A/);
  assert.match(caption, /5️⃣ Drama B/);
  assert.doesNotMatch(caption, /https?:\/\//);
  assert.match(MANUAL_REVIEW_FOLLOW_COMMENT, /https:\/\/www\.facebook\.com\/portalbeez/);
  assert.match(MANUAL_REVIEW_FOLLOW_COMMENT, /instagram\.com\/popbeez\.hive/);
});

test("manual review requires exactly five items and safe HTTPS image links", () => {
  assert.throws(() => createManualReview({ ...sample, items: sample.items.slice(0, 4) }));
  assert.throws(() => createManualReview({ ...sample, items: sample.items.map((item, index) => index === 0 ? { ...item, imageUrl: "http://images.example.test/bad.jpg" } : item) }));
});

test("manual review caption drops the watch-reason line when the field is empty", () => {
  const review = createManualReview({
    ...sample,
    items: sample.items.map((item, index) => index === 0 ? { ...item, reason: "" } : item),
  });
  const caption = buildManualReviewCaption(review);
  assert.doesNotMatch(caption, /Drama A[^\n]*\n• Kenapa wajib nonton/);
  assert.match(caption, /Drama A/);
  assert.match(caption, /Drama D/);
});

test("manual images use a publisher Referer instead of the Facebook page", () => {
  assert.equal(manualImageReferer("https://6.soompi.io/wp-content/uploads/image/gift.jpg?s=900x600"), "https://www.soompi.com/");
  assert.equal(manualImageReferer("https://www.dramabeans.com/wp-content/uploads/poster.jpg"), "https://www.dramabeans.com/");
  assert.equal(manualImageReferer("https://i0.wp.com/www.dramabeans.com/wp-content/uploads/poster.jpg?resize=600"), "https://www.dramabeans.com/");
  assert.notEqual(manualImageReferer("https://www.dramabeans.com/wp-content/uploads/poster.jpg"), "https://www.facebook.com/portalbeez");
});
