import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuizCaption,
  posterTitleKey,
  quizAvailablePosters,
  quizIntervalDays,
  quizPosterUsage,
  quizPostersFromReviews,
  QUIZ_MAX_USES,
  QUIZ_TILES,
  selectQuizPosters,
  shouldPostQuiz,
  type QuizPoster,
} from "../src/lib/quiz";

function review(id: string, createdAt: string, items: Array<[string, string]>) {
  return { id, createdAt: new Date(createdAt), items: items.map(([title, imageUrl]) => ({ title, imageUrl })) };
}

/** A flat list of posters titled A, B, C… all from the same review. */
function letterPosters(count: number): QuizPoster[] {
  return Array.from({ length: count }, (_, index) => ({
    reviewId: "review",
    reviewCreatedAt: new Date("2026-01-01T00:00:00Z"),
    title: String.fromCharCode(65 + index),
    imageUrl: `https://img.example/${String.fromCharCode(97 + index)}.jpg`,
  }));
}

test("posters come from the newest review first and are deduplicated by title", () => {
  const posters = quizPostersFromReviews([
    review("older", "2026-01-01T00:00:00Z", [["Vincenzo", "https://img.example/1.jpg"], ["Vincenzo!", "https://img.example/2.jpg"], ["Goblin", "https://img.example/3.jpg"]]),
    review("newer", "2026-01-08T00:00:00Z", [["Goblin", "https://img.example/3b.jpg"], ["Reply 1988", "https://img.example/4.jpg"]]),
  ]);

  assert.deepEqual(posters.map((poster) => poster.title), ["Goblin", "Reply 1988", "Vincenzo"]);
  assert.equal(posters[0]!.reviewId, "newer");
  assert.equal(posters[1]!.reviewId, "newer");
  assert.equal(posters[2]!.reviewId, "older");
  // The older Goblin poster is dropped because the newest review already covers that title.
  assert.equal(posters[0]!.imageUrl, "https://img.example/3b.jpg");
});

test("posters require an HTTPS url and a title", () => {
  const posters = quizPostersFromReviews([
    review("r1", "2026-01-01T00:00:00Z", [["", "https://img.example/a.jpg"], ["Ok", "http://img.example/b.jpg"], ["Fine", "https://img.example/c.jpg"]]),
  ]);
  assert.deepEqual(posters.map((poster) => poster.title), ["Fine"]);
});

test("poster title keys ignore punctuation and case", () => {
  assert.equal(posterTitleKey("Vincenzo!"), posterTitleKey("vincenzo"));
  assert.equal(posterTitleKey("Reply 1988"), "reply 1988");
});

test("edition history marks how often each poster was already used", () => {
  const usage = quizPosterUsage([
    { posterKeys: ["https://img.example/a.jpg", "https://img.example/a.jpg", "https://img.example/b.jpg"] },
    { posterKeys: ["https://img.example/b.jpg"] },
    { posterKeys: null },
  ]);
  assert.deepEqual(usage, { "https://img.example/a.jpg": 1, "https://img.example/b.jpg": 2 });
});

test("a poster is retired after three quizzes", () => {
  const posters = letterPosters(3);
  const usage = {
    "https://img.example/a.jpg": QUIZ_MAX_USES,
    "https://img.example/b.jpg": QUIZ_MAX_USES - 1,
  };

  const available = quizAvailablePosters(posters, { usage });
  assert.deepEqual(available.map((poster) => poster.title), ["B", "C"]);

  const picked = selectQuizPosters(available, { count: 3, usage, random: () => 0.5 });
  assert.ok(!picked.some((poster) => poster.title === "A"), "poster yang sudah 3× tidak boleh dipakai lagi");
  assert.equal(picked.length, 2);
});

test("selection is random across the eligible pool", () => {
  const posters = letterPosters(10);

  const low = selectQuizPosters(posters, { random: () => 0 });
  const high = selectQuizPosters(posters, { random: () => 0.999999 });
  assert.equal(low.length, QUIZ_TILES);
  assert.equal(high.length, QUIZ_TILES);
  assert.deepEqual([...low].map((poster) => poster.title).sort(), ["B", "C", "D", "E", "F"]);
  assert.deepEqual([...high].map((poster) => poster.title).sort(), ["A", "B", "C", "D", "E"]);
  assert.notDeepEqual(low.map((poster) => poster.title), high.map((poster) => poster.title));
});

test("caption stays link-free and mentions the poster count", () => {
  const caption = buildQuizCaption();
  assert.equal(QUIZ_TILES, 5);
  assert.ok(caption.includes("TEBAK DRAMA"));
  assert.ok(caption.includes("5 poster"));
  assert.ok(caption.includes("#TebakDramanya"));
  assert.ok(!/https?:\/\//i.test(caption));
  assert.ok(!/kunci jawaban:/.test(caption), "caption tidak boleh memuat kunci jawaban");
});

test("quiz only runs on Sunday inside the 19:15 WITA window", () => {
  // 2026-01-04 is a Sunday; 11:15 UTC = 19:15 WITA.
  const inside = new Date("2026-01-04T11:15:00Z");
  assert.equal(shouldPostQuiz(inside, null).due, true);
  // Grace is 14 minutes: 19:15–19:28 WITA is inside, 19:29 is already outside.
  assert.equal(shouldPostQuiz(new Date("2026-01-04T11:28:00Z"), null).due, true);
  assert.equal(shouldPostQuiz(new Date("2026-01-04T11:29:00Z"), null).due, false);
  assert.equal(shouldPostQuiz(new Date("2026-01-04T11:14:00Z"), null).due, false);
  // Monday 19:15 WITA.
  assert.equal(shouldPostQuiz(new Date("2026-01-05T11:15:00Z"), null).due, false);
});

test("a quiz waits for the configured interval since the last edition", () => {
  const now = new Date("2026-01-18T11:15:00Z"); // Sunday, two weeks after 2026-01-04
  assert.equal(shouldPostQuiz(now, new Date("2026-01-04T11:15:00Z"), { intervalDays: 14 }).due, true);
  assert.equal(shouldPostQuiz(new Date("2026-01-11T11:15:00Z"), new Date("2026-01-04T11:15:00Z"), { intervalDays: 14 }).due, false);
  assert.equal(shouldPostQuiz(now, new Date("2026-01-04T11:15:00Z"), { intervalDays: 21 }).due, false);
});

test("interval days can be overridden through the environment", () => {
  assert.equal(quizIntervalDays({}), 14);
  assert.equal(quizIntervalDays({ QUIZ_INTERVAL_DAYS: "7" }), 7);
  assert.equal(quizIntervalDays({ QUIZ_INTERVAL_DAYS: "0" }), 14);
  assert.equal(quizIntervalDays({ QUIZ_INTERVAL_DAYS: "abc" }), 14);
});
