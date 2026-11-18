import assert from "node:assert/strict";
import { test } from "node:test";
import { buildManualReviewCaption, createManualReview, parseManualReview } from "../src/lib/manual-review";

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

test("manual review caption keeps numbered winners and a Popbeez follow CTA", () => {
  const caption = buildManualReviewCaption(createManualReview(sample));
  assert.match(caption, /1️⃣ JUARA MINGGU INI: Drama A/);
  assert.match(caption, /5️⃣ Drama B/);
  assert.match(caption, /https:\/\/www\.facebook\.com\/portalbeez/);
});

test("manual review requires exactly five items and safe HTTPS image links", () => {
  assert.throws(() => createManualReview({ ...sample, items: sample.items.slice(0, 4) }));
  assert.throws(() => createManualReview({ ...sample, items: sample.items.map((item, index) => index === 0 ? { ...item, imageUrl: "http://images.example.test/bad.jpg" } : item) }));
});
