import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITORIAL_VOICES,
  editorialVoiceById,
  editorialVoiceLabel,
  pickEditorialVoice,
} from "@/lib/editorial-voices";

test("empat sudut pandang tersedia dan semuanya menyebut opini eksplisit", () => {
  assert.equal(EDITORIAL_VOICES.length, 4);
  for (const voice of EDITORIAL_VOICES) {
    assert.ok(voice.label.length > 2);
    assert.match(voice.brief, /Menurut kami|Kami menilai|menurut kami/i);
  }
});

test("pemilihan voice deterministik untuk artikel yang sama", () => {
  const first = pickEditorialVoice("0b8f4a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
  const second = pickEditorialVoice("0b8f4a7e-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
  assert.equal(first.id, second.id);
});

test("rotasi menjangkau semua voice pada banyak artikel", () => {
  const seen = new Set<string>();
  for (let index = 0; index < 200; index += 1) {
    seen.add(pickEditorialVoice(`article-${index}`).id);
  }
  assert.equal(seen.size, EDITORIAL_VOICES.length);
});

test("label caption memakai nama kolom", () => {
  assert.equal(editorialVoiceLabel(editorialVoiceById("kritis")), "💡 Sudut pandang Popbeez · Kritis");
  assert.equal(editorialVoiceLabel(null), "💡 Sudut pandang Popbeez");
  assert.equal(editorialVoiceById("tidak-ada"), null);
});
