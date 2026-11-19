import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildShortlink, shortlinkBaseUrl, shortlinkSlugFor } from "../src/lib/shortlink-core";

const originalEnv = {
  SHORTLINK_BASE_URL: process.env.SHORTLINK_BASE_URL,
  APP_URL: process.env.APP_URL,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("shortlink slugs are deterministic and safe for the redirect route", () => {
  const target = "https://www.dramabeans.com/2026/11/story/?utm=abc";
  const slug = shortlinkSlugFor(target);
  assert.equal(slug, shortlinkSlugFor(target));
  assert.match(slug, /^[a-z0-9]{6,12}$/);
  assert.notEqual(slug, shortlinkSlugFor("https://www.dramabeans.com/2026/11/other/"));
  assert.equal(buildShortlink("https://pop.beez.id", slug), `https://pop.beez.id/s/${slug}`);
});

test("shortlink base prefers SHORTLINK_BASE_URL and accepts localhost for development", () => {
  process.env.SHORTLINK_BASE_URL = "https://pop.beez.id/";
  process.env.APP_URL = "https://app.example";
  assert.equal(shortlinkBaseUrl(), "https://pop.beez.id");

  delete process.env.SHORTLINK_BASE_URL;
  assert.equal(shortlinkBaseUrl(), "https://app.example");

  process.env.APP_URL = "http://localhost:3000";
  assert.equal(shortlinkBaseUrl(), "http://localhost:3000");

  process.env.APP_URL = "not-a-url";
  assert.equal(shortlinkBaseUrl(), null);
});
