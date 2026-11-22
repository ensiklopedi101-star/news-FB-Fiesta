import test from "node:test";
import assert from "node:assert/strict";
import { roundupSlideUrls, selectedRoundupImage, selectRoundup } from "@/lib/roundup";

const breaking = (id: string) => ({ id, pillar: "breaking" as const });

test("roundup uses one selected image per article and ignores image-less articles", () => {
  assert.equal(selectedRoundupImage({ imageUrl: null, imageUrls: [], manualImageUrls: [] }), null);
  assert.equal(selectedRoundupImage({ imageUrl: "https://source.test/default.jpg", manualImageUrls: ["https://manual.test/chosen.jpg"] }), "https://manual.test/chosen.jpg");
  assert.equal(selectedRoundupImage({ imageUrl: null, imageUrls: ["https://source.test/gallery.jpg"] }), "https://source.test/gallery.jpg");
  assert.equal(selectedRoundupImage({ imageUrl: "https://cdn.rss.app/brand.png", imageUrls: [] }), null);
});

test("each carousel image URL carries exactly four ordered source IDs and its matching slide index", () => {
  const ids = ["a", "b", "c", "d"].map((value) => `${value}0000000-0000-4000-8000-000000000000`);
  const urls = roundupSlideUrls("https://popbeez.example/", ids[0]!, ids);
  assert.equal(urls.length, 4);
  urls.forEach((url, index) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("roundupIds"), ids.join(","));
    assert.equal(parsed.searchParams.get("slide"), String(index + 1));
  });
  assert.throws(() => roundupSlideUrls("https://popbeez.example", ids[0]!, [...ids, "e0000000-0000-4000-8000-000000000000"]), /exactly four/);
  assert.throws(() => roundupSlideUrls("https://popbeez.example", ids[0]!, ids.slice(0, 3)), /exactly four/);
});

test("entertainment waits instead of sending single stories until four image-eligible items exist", () => {
  assert.equal(selectRoundup([breaking("a")]), null);
  assert.equal(selectRoundup([breaking("a"), breaking("b")]), null);
});

test("three stories wait for a thumb-stopping roundup", () => {
  assert.equal(selectRoundup([breaking("a"), breaking("b"), breaking("c")]), null);
});

test("roundups always contain exactly four stories even when more are queued", () => {
  assert.deepEqual(selectRoundup([1, 2, 3, 4].map((id) => breaking(String(id))))?.map((item) => item.id), ["1", "2", "3", "4"]);
  assert.equal(selectRoundup([1, 2, 3, 4, 5, 6].map((id) => breaking(String(id))))?.length, 4);
});

test("pillar diversity is a preference and chosen ordering is preserved", () => {
  const selected = selectRoundup([
    breaking("a"), breaking("b"),
    { id: "c", pillar: "analysis" as const },
    breaking("d"), { id: "e", pillar: "manga" as const },
  ]);
  assert.deepEqual(selected?.map((item) => item.id), ["a", "c", "e", "b"]);
});
