import assert from "node:assert/strict";
import test from "node:test";
import { safeProviderError } from "../src/lib/ai-error";

test("preserves the HTTP status when a provider SDK error carries it separately", () => {
  const error = Object.assign(new Error("model not found"), { status: 404 });
  assert.equal(safeProviderError(error, []), "HTTP 404: model not found");
});

test("redacts provider secrets from detailed error payloads", () => {
  const error = Object.assign(new Error('{"error":"invalid key test-secret"}'), { status: 403 });
  const message = safeProviderError(error, ["test-secret"]);
  assert.match(message, /^HTTP 403:/);
  assert.match(message, /\[REDACTED\]/);
  assert.doesNotMatch(message, /test-secret/);
});
