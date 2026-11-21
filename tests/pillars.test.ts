import assert from "node:assert/strict";
import test from "node:test";
import { PILLARS, classifyPillar } from "../src/lib/pillars";

test("headlines land in the right pillar", () => {
  assert.equal(classifyPillar({ title: "Top 10 Drama Korea Rating Tertinggi Minggu Ini" }), "list");
  assert.equal(classifyPillar({ title: "POV Kamu Nonton Ending Drama Ini Tanpa Spoiler" }), "relatable");
  assert.equal(classifyPillar({ title: "Kenapa Drama Ini Bikin Penonton Bertahan Sampai Akhir?" }), "analysis");
  // "viral" is a reaction/relatable signal, not analysis.
  assert.equal(classifyPillar({ title: "Scene Ini Viral di TikTok" }), "relatable");
  assert.equal(classifyPillar({ title: "Pilih Bias Kamu Minggu Ini" }), "community");
  assert.equal(classifyPillar({ title: "NCT DREAM Menang Show Champion Lagi" }), "breaking");
  assert.equal(classifyPillar({ title: "Kabar terbaru dari agensi" }), "breaking");
  assert.equal(classifyPillar({ title: "Top 10 Manga yang Rilis Bulan Ini" }), "manga");
  assert.equal(classifyPillar({ title: "Chapter Baru Diumumkan", category: "Manga" }), "manga");
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
