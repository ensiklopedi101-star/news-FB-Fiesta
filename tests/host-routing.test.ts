import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { DEFAULT_SHORTLINK_ONLY_HOST, isShortlinkPath, shouldBlockForShortlinkHost } from "../src/lib/host-routing";

const original = process.env.SHORTLINK_ONLY_HOST;

afterEach(() => {
  if (original === undefined) delete process.env.SHORTLINK_ONLY_HOST;
  else process.env.SHORTLINK_ONLY_HOST = original;
});

test("the short-link host only allows /s/<slug>", () => {
  delete process.env.SHORTLINK_ONLY_HOST;
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/s/abc12345"), false);
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/s"), false);
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/"), true);
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/api/dashboard"), true);
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/_next/static/chunk.js"), true);
  assert.equal(shouldBlockForShortlinkHost(`www.${DEFAULT_SHORTLINK_ONLY_HOST}`, "/"), true);
});

test("the app host keeps serving every route", () => {
  delete process.env.SHORTLINK_ONLY_HOST;
  assert.equal(shouldBlockForShortlinkHost("portal-beez.vercel.app", "/"), false);
  assert.equal(shouldBlockForShortlinkHost("portal-beez.vercel.app", "/api/dashboard"), false);
  assert.equal(shouldBlockForShortlinkHost("portal-beez.vercel.app", "/s/abc12345"), false);
  assert.equal(shouldBlockForShortlinkHost("POPBEEZ.HIVECOMP.MY.ID:443", "/dashboard"), true);
});

test("SHORTLINK_ONLY_HOST can be overridden or turned off for a future frontend", () => {
  process.env.SHORTLINK_ONLY_HOST = "go.example.com";
  assert.equal(shouldBlockForShortlinkHost("go.example.com", "/"), true);
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/"), false);

  process.env.SHORTLINK_ONLY_HOST = "off";
  assert.equal(shouldBlockForShortlinkHost(DEFAULT_SHORTLINK_ONLY_HOST, "/"), false);
});

test("short-link path detection is strict about the /s prefix", () => {
  assert.equal(isShortlinkPath("/s/abc"), true);
  assert.equal(isShortlinkPath("/shortcut"), false);
  assert.equal(isShortlinkPath("/s"), true);
  assert.equal(isShortlinkPath("/"), false);
});
