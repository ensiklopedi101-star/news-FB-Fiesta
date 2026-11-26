import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFormatLabel, contentSegmentLabel, ratingSegmentForMediaType } from "../src/lib/content-taxonomy";

test("media-specific Top 5 segments stay separate and are human-readable", () => {
  assert.equal(ratingSegmentForMediaType("DRAMA"), "rating_drama_top_5");
  assert.equal(ratingSegmentForMediaType("film"), "rating_film_top_5");
  assert.equal(ratingSegmentForMediaType("MUSIK"), "rating_music_top_5");
  assert.equal(contentSegmentLabel("rating_film_top_5"), "Rating Film Top 5");
  assert.equal(contentSegmentLabel("artis_bio"), "Artis Bio");
  assert.equal(contentSegmentLabel("unknown"), "Belum diklasifikasikan");
});

test("content format labels remain independent of editorial segments", () => {
  assert.equal(contentFormatLabel("quiz_grid"), "Grid kuis");
  assert.equal(contentFormatLabel("video"), "Video");
  assert.equal(contentFormatLabel("unknown"), "Belum diklasifikasikan");
});
