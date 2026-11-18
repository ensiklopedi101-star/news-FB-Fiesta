import assert from "node:assert/strict";
import test from "node:test";
import { extractFeedImageUrl, extractFeedImageUrls } from "../src/lib/feed-image";

const articleUrl = "https://publisher.example/story/one";

test("extracts up to three unique safe editorial RSS images and filters decorative assets", () => {
  const images = extractFeedImageUrls({
    mediaContent: [
      { $: { url: "https://cdn.example/logo.png", type: "image/png" } },
      { $: { url: "https://cdn.example/first.jpg", type: "image/jpeg" } },
      { $: { url: "https://cdn.example/first.jpg", type: "image/jpeg" } },
      { $: { url: "https://cdn.example/second.jpg", type: "image/jpeg" } },
      { $: { url: "https://cdn.example/third.jpg", type: "image/jpeg" } },
      { $: { url: "https://cdn.example/fourth.jpg", type: "image/jpeg" } },
    ],
  }, articleUrl);
  assert.deepEqual(images, ["https://cdn.example/first.jpg", "https://cdn.example/second.jpg", "https://cdn.example/third.jpg"]);
});

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

test("extracts Markdown image URLs in RSS.app feed descriptions", () => {
  const image = extractFeedImageUrl({
    content: "<![CDATA[News summary\\n\\n![](https://i.mydramalist.com/lBB3KN_2f.jpg)\\n\\nMore text]]>",
  }, "https://rss.app/articles/example");

  assert.equal(image, "https://i.mydramalist.com/lBB3KN_2f.jpg");
});

test("rejects RSS.app's default logo as a source image", () => {
  const images = extractFeedImageUrls({
    mediaThumbnail: { $: { url: "https://rss.app/static/img/images/rss-app.png", type: "image/png" } },
    content: "![](https://i.mydramalist.com/lBB3KN_2f.jpg)",
  }, "https://rss.app/articles/example");

  assert.deepEqual(images, ["https://i.mydramalist.com/lBB3KN_2f.jpg"]);
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
