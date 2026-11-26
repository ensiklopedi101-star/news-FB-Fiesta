import assert from "node:assert/strict";
import { test } from "node:test";
import { feedPresets } from "../src/lib/feed-presets";

test("provides active, focused presets for C-dramas, donghua, and K-pop idols", () => {
  const required = [
    ["Soompi All News", "ENTERTAINMENT"],
    ["Seoulbeats", "K-POP"],
    ["DramaPanda C-News", "C-DRAMA"],
    ["MyDramaList News", "DRAMA"],
    ["Overseasidol C-Drama", "C-DRAMA"],
    ["Yu Alexius Chinese Anime", "DONGHUA"],
    ["My Donghua Review", "DONGHUA"],
    ["Soompi K-Pop", "K-POP"],
    ["Yonhap Culture and K-Pop", "K-POP"],
  ] as const;

  for (const [name, category] of required) {
    const preset = feedPresets.find((feed) => feed.name === name);
    assert.ok(preset, `missing preset ${name}`);
    assert.equal(preset.category, category);
    assert.equal(preset.pageKey, "entertainment");
    assert.equal(preset.active, true);
  }
});
