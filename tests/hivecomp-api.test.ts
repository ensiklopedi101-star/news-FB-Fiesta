import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getHiveCompCardUrl,
  isHiveCompAuthorized,
  parseHiveCompBrand,
  parseHiveCompLimit,
  toHiveCompPost,
} from "../src/lib/hivecomp-api";
import { createReadApiRateLimiter, getClientRateLimitKey } from "../src/lib/read-only-api";

const article = {
  id: "post_123",
  title: "Judul artikel",
  caption: "  Teks postingan  ",
  imageUrl: null,
  createdAt: new Date("2026-02-10T07:55:00-08:00"),
  publishedAt: new Date("2026-02-10T16:00:00+08:00"),
};

test("accepts only the two supported HiveComp brands", () => {
  assert.equal(parseHiveCompBrand("popbeez"), "popbeez");
  assert.equal(parseHiveCompBrand("nusabeez"), "nusabeez");
  for (const brand of ["other", "Popbeez", "", "entertainment", "news"]) {
    assert.equal(parseHiveCompBrand(brand), null);
  }
});

test("authenticates an exact Bearer token and rejects missing or incorrect values", () => {
  assert.equal(isHiveCompAuthorized("Bearer secret-token", "secret-token"), true);
  assert.equal(isHiveCompAuthorized("bearer secret-token", "secret-token"), true);
  for (const value of [null, "", "Bearer wrong", "Bearer secret-wrong", "secret-token", "Basic secret-token", "Bearer secret-token extra"]) {
    assert.equal(isHiveCompAuthorized(value, "secret-token"), false);
  }
  assert.equal(isHiveCompAuthorized("Bearer secret-token", ""), false);
  assert.equal(isHiveCompAuthorized("Bearer secret-token", "   "), false);
});

test("defaults the limit to three, permits smaller limits, and clamps the maximum", () => {
  assert.equal(parseHiveCompLimit("1"), 1);
  assert.equal(parseHiveCompLimit("2"), 2);
  assert.equal(parseHiveCompLimit("3"), 3);
  assert.equal(parseHiveCompLimit("100"), 3);
  for (const limit of [null, "", "0", "-1", "2.5", "2abc", "Infinity", "9007199254740992"]) {
    assert.equal(parseHiveCompLimit(limit), 3);
  }
});

test("maps only available safe post fields and formats publication time in UTC", () => {
  assert.deepEqual(toHiveCompPost(article, "https://news.example/api/og/post_123"), {
    id: "post_123",
    message: "Teks postingan",
    created_time: "2026-02-10T08:00:00.000Z",
    full_picture: "https://news.example/api/og/post_123",
  });
});

test("omits unavailable metrics, permalink, and publication time rather than inventing values", () => {
  const post = toHiveCompPost({ ...article, caption: null, imageUrl: "http://insecure.example/image.jpg", publishedAt: null });
  assert.deepEqual(post, { id: "post_123", message: "Judul artikel" });
  for (const key of ["reactions", "comments", "shares", "permalink_url", "created_time", "createdAt"]) {
    assert.equal(key in (post ?? {}), false);
  }
  assert.equal(toHiveCompPost({ ...article, publishedAt: new Date("invalid") })?.created_time, undefined);
});

test("allows an absolute public HTTPS picture, but rejects unsafe or credential-bearing URLs", () => {
  assert.equal(toHiveCompPost({ ...article, imageUrl: "https://cdn.example/card.jpg" })?.full_picture, "https://cdn.example/card.jpg");
  for (const imageUrl of [
    "/card.jpg", "http://cdn.example/card.jpg", "https://127.0.0.1/card.jpg",
    "https://user:password@cdn.example/card.jpg", "https://cdn.example/card.jpg?access_token=secret",
    "https://cdn.example/card.jpg#token=secret", "https://cdn.example/card.jpg?email=private@example.com",
  ]) {
    assert.equal(toHiveCompPost({ ...article, imageUrl })?.full_picture, undefined);
  }
});

test("builds card URLs only from trusted public HTTPS APP_URL, not a request Host header", () => {
  assert.equal(getHiveCompCardUrl("post_123", "https://news.example/base?token=secret"), "https://news.example/api/og/post_123");
  assert.equal(getHiveCompCardUrl("a/b", "https://news.example"), "https://news.example/api/og/a%2Fb");
  for (const appUrl of [undefined, "", "/relative", "http://news.example", "https://localhost", "https://user:secret@news.example"]) {
    assert.equal(getHiveCompCardUrl("post_123", appUrl), undefined);
  }
});

test("redacts contact details and credentials embedded in a public caption", () => {
  const token = "private-unit-test-token";
  const post = toHiveCompPost({
    ...article,
    caption: `Tanggal 2026-02-10; editor@example.com; +62 812-3456-7890; Bearer other.secret; ${token}; https://example.test/?access_token=hidden-secret`,
    imageUrl: `https://cdn.example/${token}.jpg`,
  }, undefined, [token]);
  assert.ok(post);
  for (const value of ["editor@example.com", "812-3456-7890", "other.secret", token, "hidden-secret"]) {
    assert.equal(JSON.stringify(post).includes(value), false);
  }
  assert.ok(post.message.includes("2026-02-10"));
  assert.equal(post.full_picture, undefined);
});

test("requires non-empty id and message", () => {
  assert.equal(toHiveCompPost({ ...article, title: "  ", caption: null }), null);
  assert.equal(toHiveCompPost({ ...article, id: "  " }), null);
});

test("rate limits each client, reports a relative reset, and resets the counter", () => {
  let now = 1_000;
  const limiter = createReadApiRateLimiter(2, 60_000, () => now);
  assert.deepEqual(limiter("client-a"), { allowed: true, limit: 2, remaining: 1, retryAfter: 60 });
  assert.equal(limiter("client-a").allowed, true);
  assert.equal(limiter("client-a").allowed, false);
  assert.equal(limiter("client-b").allowed, true);
  now += 59_000;
  assert.equal(limiter("client-a").retryAfter, 1);
  now += 1_000;
  assert.equal(limiter("client-a").allowed, true);
});

test("a flood of new IPs cannot evict an active rate-limit counter", () => {
  const limiter = createReadApiRateLimiter(1, 60_000, () => 1_000);
  assert.equal(limiter("client-a").allowed, true);
  for (let index = 0; index < 10_000; index += 1) limiter(`client-${index}`);
  assert.equal(limiter("overflow-client").allowed, false);
  assert.equal(limiter("client-a").allowed, false);
});

test("uses bounded proxy IP keys, with a shared bucket when IP is unavailable", () => {
  assert.equal(getClientRateLimitKey(new Headers()), "unknown");
  assert.equal(getClientRateLimitKey(new Headers({ "x-forwarded-for": "203.0.113.1, 203.0.113.2" })), "203.0.113.1");
  assert.equal(getClientRateLimitKey(new Headers({ "x-real-ip": "203.0.113.3", "x-forwarded-for": "203.0.113.1" })), "203.0.113.3");
  assert.equal(getClientRateLimitKey(new Headers({ "x-real-ip": "x".repeat(500) })).length, 128);
});
