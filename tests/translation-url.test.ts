import assert from "node:assert/strict";
import { test } from "node:test";
import { indonesianTranslationUrl } from "../src/lib/translation-url";

test("builds a Google Translate link targeting Indonesian and retaining the source URL", () => {
  const sourceUrl = "https://news.example.test/story?id=42&lang=en";
  const translatedUrl = new URL(indonesianTranslationUrl(sourceUrl));

  assert.equal(translatedUrl.origin, "https://translate.google.com");
  assert.equal(translatedUrl.pathname, "/translate");
  assert.equal(translatedUrl.searchParams.get("sl"), "auto");
  assert.equal(translatedUrl.searchParams.get("tl"), "id");
  assert.equal(translatedUrl.searchParams.get("u"), sourceUrl);
});
