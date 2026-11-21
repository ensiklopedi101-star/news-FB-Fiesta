import assert from "node:assert/strict";
import test from "node:test";
import { PILLARS, classifyPillar, pillarMaxPerDay, pillarQuotaEnabled, selectByPillar } from "../src/lib/pillars";

test("headlines land in the right pillar", () => {
  assert.equal(classifyPillar({ title: "Top 10 Drama Korea Rating Tertinggi Minggu Ini" }), "list");
  assert.equal(classifyPillar({ title: "POV Kamu Nonton Ending Drama Ini Tanpa Spoiler" }), "relatable");
  assert.equal(classifyPillar({ title: "Kenapa Drama Ini Bikin Penonton Bertahan Sampai Akhir?" }), "analysis");
  // "viral" is a reaction/relatable signal, not analysis.
  assert.equal(classifyPillar({ title: "Scene Ini Viral di TikTok" }), "relatable");
  assert.equal(classifyPillar({ title: "Pilih Bias Kamu Minggu Ini" }), "community");
  assert.equal(classifyPillar({ title: "NCT DREAM Menang Show Champion Lagi" }), "breaking");
  assert.equal(classifyPillar({ title: "Kabar terbaru dari agensi" }), "breaking");
});

test("list wins over breaking when a title has both signals", () => {
  // Ranked articles are internally consistent; time-sensitive ones are not.
  assert.equal(classifyPillar({ title: "Ranking rating drama terbaru" }), "list");
});

test("every pillar has a brief and a share for the dashboard", () => {
  for (const pillar of Object.values(PILLARS)) {
    assert.ok(pillar.label.length > 0);
    assert.ok(pillar.brief.length > 20);
    assert.ok(pillar.summary.length > 10);
    assert.ok(pillar.reelsBoost >= 1 && pillar.reelsBoost <= 3);
  }
});

test("quota config is env-tunable and defaults to one per pillar per day", () => {
  assert.equal(pillarMaxPerDay({}), 1);
  assert.equal(pillarMaxPerDay({ PILLAR_MAX_PER_DAY: "3" }), 3);
  assert.equal(pillarMaxPerDay({ PILLAR_MAX_PER_DAY: "0" }), 1);
  assert.equal(pillarMaxPerDay({ PILLAR_MAX_PER_DAY: "99" }), 12);
  assert.equal(pillarQuotaEnabled({}), true);
  assert.equal(pillarQuotaEnabled({ PILLARS_ENABLED: "0" }), false);
});

test("selection skips a capped pillar and avoids repeating the previous one", () => {
  const candidates = [
    { id: "a", pillar: "breaking" as const },
    { id: "b", pillar: "analysis" as const },
    { id: "c", pillar: "list" as const },
  ];

  // Breaking already used today → next candidate wins.
  assert.equal(selectByPillar(candidates, { todayCounts: { breaking: 1 }, maxPerDay: 1, previousPillar: "list" })?.id, "b");
  // Analysis was the previous post → list is preferred over repeating it.
  assert.equal(selectByPillar(candidates, { todayCounts: {}, maxPerDay: 1, previousPillar: "analysis" })?.id, "a");
  // Everything capped → still returns something instead of stalling the queue.
  const capped = { breaking: 1, analysis: 1, list: 1 };
  assert.ok(selectByPillar(candidates, { todayCounts: capped, maxPerDay: 1, previousPillar: "list" }));
  // Quota disabled → plain FIFO order.
  assert.equal(selectByPillar(candidates, { todayCounts: { breaking: 5 }, maxPerDay: 1, enabled: false })?.id, "a");
});
