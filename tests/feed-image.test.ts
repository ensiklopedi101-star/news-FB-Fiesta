import assert from "node:assert/strict";
import test from "node:test";
import { extractFeedImageUrl } from "../src/lib/feed-image";

const articleUrl = "https://publisher.example/story/one";

test("extracts RSS media images including repeated media:content fields", () => {
  const image = extractFeedImageUrl({
    mediaContent: [
      { $: { url: "https://cdn.example/video.mp4", type: "video/mp4" } },
      { $: { url: "https://cdn.example/story.jpg", type: "image/jpeg" } },
    ],
  }, articleUrl);

  assert.equal(image, "https://cdn.example/story.jpg");
});

test("finds lazy-loaded images in description when an RSS item has no media fields", () => {
  const image = extractFeedImageUrl({
    description: '<p>Ringkasan</p><img data-src="/photos/story.webp" alt="foto" />',
  }, articleUrl);

  assert.equal(image, "https://publisher.example/photos/story.webp");
});

test("uses RSS content images after rejecting non-image enclosures and unsafe URLs", () => {
  const image = extractFeedImageUrl({
    enclosure: { url: "https://cdn.example/audio.mp3", type: "audio/mpeg" },
    contentEncoded: '<img src="http://cdn.example/insecure.jpg"><img src="https://cdn.example/valid.jpg">',
  }, articleUrl);

  assert.equal(image, "https://cdn.example/valid.jpg");
});

test("accepts media:group nested image entries and srcset candidates", () => {
  const nested = extractFeedImageUrl({
    mediaContent: { "media:group": { "media:content": [{ $: { url: "https://cdn.example/group.jpg" } }] } },
  }, articleUrl);
  const srcset = extractFeedImageUrl({
    summary: '<img srcset="https://cdn.example/small.jpg 480w, https://cdn.example/large.jpg 1200w">',
  }, articleUrl);

  assert.equal(nested, "https://cdn.example/group.jpg");
  assert.equal(srcset, "https://cdn.example/large.jpg");
});
