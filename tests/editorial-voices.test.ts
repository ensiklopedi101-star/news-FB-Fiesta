import assert from "node:assert/strict";
import test from "node:test";

import {
  EDITORIAL_VOICES,
  VOICE_STYLE_GUIDE,
  editorialVoiceById,
  editorialVoiceLabel,
  pickEditorialVoice,
} from "@/lib/editorial-voices";

test("empat sudut pandang tersedia dan semuanya memakai gaya bicara PopBeez", () => {
  assert.equal(EDITORIAL_VOICES.length, 4);
  for (const voice of EDITORIAL_VOICES) {
    assert.ok(voice.label.length > 2);
    assert.match(voice.brief, /PopBeez|popbeez/);
    assert.match(voice.brief, /sih|deh|nih|banget|rasa/);
  }
});

test("panduan gaya melarang label dan frasa kaku", () => {
  assert.match(VOICE_STYLE_GUIDE, /Sudut pandang PopBeez/);
  assert.match(VOICE_STYLE_GUIDE, /tak dapat dipungkiri/);
  assert.match(VOICE_STYLE_GUIDE, /Beezers/);
  assert.match(VOICE_STYLE_GUIDE, /Menurut PopBeez sih/);
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

test("nama nada hanya untuk dashboard, bukan untuk caption", () => {
  assert.equal(editorialVoiceLabel(editorialVoiceById("kritis")), "Nada Kritis");
  assert.equal(editorialVoiceLabel(null), "Nada bebas");
  assert.equal(editorialVoiceById("tidak-ada"), null);
});
