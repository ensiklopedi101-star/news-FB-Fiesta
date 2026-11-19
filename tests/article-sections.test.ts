import assert from "node:assert/strict";
import { test } from "node:test";
import { articleSection, facebookPostUrl, isLivePost, splitArticleSections } from "../src/lib/article-sections";

test("rows that already left the dashboard are separated from the ones that did not", () => {
  const rows = [
    { id: "a", status: "queued" },
    { id: "b", status: "ready" },
    { id: "c", status: "published" },
    { id: "d", status: "processing" },
    { id: "e", status: "failed" },
    { id: "f", status: "ready" },
  ];
  const sections = splitArticleSections(rows);
  assert.deepEqual(sections.queue.map((row) => row.id), ["a"]);
  assert.deepEqual(sections.sending.map((row) => row.id), ["d"]);
  assert.deepEqual(sections.failed.map((row) => row.id), ["e"]);
  // `ready` means Buffer accepted the post, so it belongs to "sudah terbit".
  assert.deepEqual(sections.done.map((row) => row.id), ["b", "c", "f"]);
});

test("input order is preserved inside every section", () => {
  const queue = [{ status: "queued", id: "first" }, { status: "queued", id: "second" }, { status: "queued", id: "third" }];
  assert.deepEqual(splitArticleSections(queue).queue.map((row) => row.id), ["first", "second", "third"]);
});

test("expired and removed rows stay hidden from both lists", () => {
  assert.equal(articleSection("expired"), null);
  assert.equal(articleSection("removed"), null);
  assert.equal(articleSection("scheduled"), null);
  const sections = splitArticleSections([{ status: "expired" }, { status: "removed" }, { status: "published" }]);
  assert.equal(sections.queue.length, 0);
  assert.equal(sections.sending.length, 0);
  assert.equal(sections.failed.length, 0);
  assert.equal(sections.done.length, 1);
});

test("only the published status counts as live on the page", () => {
  assert.equal(isLivePost("published"), true);
  assert.equal(isLivePost("ready"), false);
  assert.equal(isLivePost("queued"), false);
});

test("only real Facebook post ids become permalinks", () => {
  assert.equal(facebookPostUrl("123456789_987654321"), "https://www.facebook.com/123456789_987654321");
  assert.equal(facebookPostUrl("987654321"), "https://www.facebook.com/987654321");
  assert.equal(facebookPostUrl("buffer:abc123"), null);
  assert.equal(facebookPostUrl("facebook:pending:abc"), null);
  assert.equal(facebookPostUrl("buffer:pending:abc"), null);
  assert.equal(facebookPostUrl(null), null);
  assert.equal(facebookPostUrl(""), null);
});
