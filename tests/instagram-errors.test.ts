import assert from "node:assert/strict";
import test from "node:test";
import {
  InstagramError,
  containerState,
  formatGraphError,
  isMediaNotAvailable,
  publishRetryDelayMs,
  redactToken,
} from "../src/lib/instagram-errors";

test("code 9007 is recognised as a not-ready container, not a hard failure", () => {
  const error = formatGraphError(400, { error: { message: "Media ID is not available", code: 9007 } }, "secret-token");
  assert.ok(error instanceof InstagramError);
  assert.equal(error.code, 9007);
  assert.ok(isMediaNotAvailable(error));
  assert.match(error.message, /code 9007/);
  assert.match(error.message, /container FINISHED|belum siap/i);
});

test("other errors are not retried as media-not-ready", () => {
  const permission = formatGraphError(403, { error: { message: "Permissions error", code: 200 } }, "t");
  assert.equal(isMediaNotAvailable(permission), false);
  assert.match(permission.message, /instagram_content_publish/);
  assert.equal(isMediaNotAvailable(new Error("boom")), false);
});

test("container states map Meta's status codes", () => {
  assert.equal(containerState("FINISHED"), "ready");
  assert.equal(containerState("PUBLISHED"), "ready");
  assert.equal(containerState("ERROR"), "failed");
  assert.equal(containerState("EXPIRED"), "failed");
  assert.equal(containerState("IN_PROGRESS"), "pending");
  assert.equal(containerState(undefined), "pending");
});

test("retry delays grow and stay bounded", () => {
  assert.equal(publishRetryDelayMs(0), 4_000);
  assert.equal(publishRetryDelayMs(1), 8_000);
  assert.ok(publishRetryDelayMs(9) <= 15_000);
});

test("tokens never leak into logs", () => {
  assert.equal(redactToken("bad token abc123 here", "abc123"), "bad token [REDACTED] here");
  assert.match(redactToken("https://x?access_token=sekret&id=1", "sekret"), /access_token=\[REDACTED\]&id=1/);
});
