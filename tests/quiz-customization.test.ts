import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentQuizDraft, quizDifficulties, quizEditsSchema, validateQuizSelection } from "../src/lib/quiz-customization";
const sources = Array.from({ length: 6 }, (_, i) => ({ title: `Drama ${i}`, imageUrl: `https://example.com/${i}.jpg`, reviewId: `review-${i}` }));
test("quiz effects default to medium for all five tiles and accept only defined levels", () => {
  assert.deepEqual(quizDifficulties(null), Array(5).fill("medium"));
  assert.deepEqual(quizDifficulties([]), Array(5).fill("medium"));
  assert.deepEqual(quizDifficulties(["bogus"]), Array(5).fill("medium"));
  assert.deepEqual(quizDifficulties(["easy", "medium", "hard", "easy", "medium"]), ["easy", "medium", "hard", "easy", "medium"]);
});
test("edit payload requires an exact preview and five legal tile effects", () => {
  const body = { editionId: "de305d54-75b4-431b-adb2-eb6b9e546014", previewUrl: "https://example.com/preview.jpg", tiles: sources.slice(0, 5).map(s => ({ imageUrl: s.imageUrl, difficulty: "medium" })) };
  assert.ok(quizEditsSchema.safeParse(body).success);
  assert.equal(quizEditsSchema.safeParse({ ...body, previewUrl: undefined }).success, false);
  assert.equal(quizEditsSchema.safeParse({ ...body, tiles: body.tiles.slice(0, 4) }).success, false);
  assert.equal(quizEditsSchema.safeParse({ ...body, tiles: body.tiles.map(t => ({ ...t, difficulty: "extreme" })) }).success, false);
});
test("replacing one poster preserves all other positions and derives source metadata server-side", () => {
  const tiles = sources.slice(0, 5).map(s => ({ imageUrl: s.imageUrl }));
  tiles[3] = { imageUrl: sources[5].imageUrl };
  const selected = validateQuizSelection(tiles, sources);
  assert.deepEqual(selected.map(s => s.title), ["Drama 0", "Drama 1", "Drama 2", "Drama 5", "Drama 4"]);
  assert.equal(selected[3].reviewId, "review-5");
});
test("unknown, exhausted and duplicate posters/titles cannot enter the selection", () => {
  const tiles = sources.slice(0, 5);
  assert.throws(() => validateQuizSelection(tiles, sources.slice(0, 4)));
  assert.throws(() => validateQuizSelection([tiles[0], tiles[0], ...tiles.slice(2)], sources));
  assert.throws(() => validateQuizSelection(tiles, sources.map((s, i) => i === 1 ? { ...s, title: "Drama 0!" } : s)));
});
test("stale previews and rendering/publishing/published editions cannot be edited or approved", () => {
  const url = "https://example.com/new-preview.jpg";
  assert.equal(isCurrentQuizDraft({ status: "draft", imageUrl: url }, url), true);
  assert.equal(isCurrentQuizDraft({ status: "draft", imageUrl: url }, "https://example.com/old.jpg"), false);
  assert.equal(isCurrentQuizDraft({ status: "draft", imageUrl: null }, url), false);
  for (const status of ["editing", "generating", "publishing", "published", "failed", "rejected", "legacy"]) {
    assert.equal(isCurrentQuizDraft({ status, imageUrl: url }, url), false);
  }
});
