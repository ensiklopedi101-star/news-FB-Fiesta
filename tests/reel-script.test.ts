import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReelCaption,
  buildReelScenes,
  estimateSeconds,
  splitSentences,
  toSpeechText,
  totalSeconds,
} from "@/lib/reel-script";

const narration =
  "Drama ini menutup musim dengan rating tertinggi tahun ini. " +
  "Kalau dibandingkan judul kabel lain, lonjakannya datang dari penonton lama. " +
  "Menurut kami, keputusan menahan musim kedua justru tepat. " +
  "Kamu sendiri berhenti di episode berapa?";

test("teks untuk TTS dibersihkan dari emoji, tautan, dan hashtag", () => {
  const clean = toSpeechText("Cek ini 🔥 https://contoh.id/berita #DramaKorea “kutipan” *miring*");
  assert.equal(clean.includes("🔥"), false);
  assert.equal(clean.includes("http"), false);
  assert.equal(clean.includes("#"), false);
  assert.equal(clean.includes("“"), false);
  assert.equal(clean.includes("DramaKorea"), false);
  assert.match(clean, /kutipan miring/);
});

test("kalimat dipecah tanpa memotong singkatan karena titik", () => {
  const sentences = splitSentences(narration);
  assert.equal(sentences.length, 4);
  assert.match(sentences[3]!, /episode berapa/);
});

test("setiap scene punya durasi layak dan jumlahnya dibatasi", () => {
  const scenes = buildReelScenes(narration);
  assert.ok(scenes.length >= 2 && scenes.length <= 8);
  for (const scene of scenes) assert.ok(scene.seconds >= 1.6, `durasi ${scene.seconds}`);
  assert.ok(totalSeconds(scenes) > 5);
});

test("kalimat sangat panjang dipecah menjadi beberapa frame", () => {
  const long = `${"film drama korea terbaru ini ".repeat(12)}selesai.`;
  const scenes = buildReelScenes(long);
  assert.ok(scenes.length > 1);
  for (const scene of scenes) assert.ok(scene.text.split(/\s+/).length <= 20);
});

test("estimasi durasi punya batas bawah", () => {
  assert.equal(estimateSeconds("Halo."), 1.6);
  assert.ok(estimateSeconds("satu dua tiga empat lima enam tujuh delapan sembilan sepuluh") > 1.6);
});

test("caption Reel membawa pertanyaan, hashtag, dan sumber", () => {
  const caption = buildReelCaption({
    headline: "Rating Drama Ini Tembus Dua Digit",
    question: "Kamu berhenti di episode berapa?",
    sourceName: "Soompi",
  });
  assert.match(caption, /Rating Drama Ini/);
  assert.match(caption, /Kamu berhenti di episode berapa\?/);
  assert.match(caption, /#Popbeez/);
  assert.match(caption, /📰 Soompi/);
});
