import assert from "node:assert/strict";
import { test } from "node:test";
import { imageForCarouselSlide } from "../src/lib/carousel-image";

test("carousel factual slides choose unique gallery photos and fall back to the cover", () => {
  const gallery = ["cover.jpg", "detail-a.jpg", "detail-b.jpg"];
  assert.equal(imageForCarouselSlide(gallery, gallery[0]!, 1), "cover.jpg");
  assert.equal(imageForCarouselSlide(gallery, gallery[0]!, 2), "detail-a.jpg");
  assert.equal(imageForCarouselSlide(gallery, gallery[0]!, 3), "detail-b.jpg");
  assert.equal(imageForCarouselSlide(gallery, gallery[0]!, 4), "cover.jpg");
  assert.equal(imageForCarouselSlide(["cover.jpg"], "cover.jpg", 2), "cover.jpg");
});
