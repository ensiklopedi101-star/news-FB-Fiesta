import assert from "node:assert/strict";
import test from "node:test";

import { composeCaption, formatRoundupStories, normalizeBrand, withAudience } from "@/lib/caption";

const paragraphs: [string, string] = [
  "WayV akhirnya buka suara soal rencana tur lintas benua mereka. Kabarnya sih udah disiapin dari tahun lalu.",
  "Yang bikin beda, mereka milih nunggu waktu yang pas ketimbang buru-buru ikut tren.",
];

test("roundup caption titles and summaries remain paired in the supplied article order", () => {
  assert.deepEqual(
    formatRoundupStories(["Judul pertama", "Judul kedua", "Judul ketiga", "Judul keempat"], ["Ringkasan satu", "Ringkasan dua", "Ringkasan tiga", "Ringkasan empat"]),
    ["1. Judul pertama — Ringkasan satu", "2. Judul kedua — Ringkasan dua", "3. Judul ketiga — Ringkasan tiga", "4. Judul keempat — Ringkasan empat"],
  );
  assert.throws(() => formatRoundupStories(["Judul"], []), /jumlah yang sama/);
});

test("caption tidak memakai label sudut pandang", () => {
  const caption = composeCaption({
    paragraphs,
    take: "Menurut PopBeez sih, kesabaran mereka harus diacungi jempol deh 👍",
    question: "Beezers, kamu paling nunggu kota mana?",
    hashtags: ["#WayV", "#PopBeez", "#Kpop"],
  });
  assert.equal(caption.includes("Sudut pandang"), false);
  assert.equal(caption.includes("💡"), false);
  const blocks = caption.split("\n\n");
  assert.equal(blocks.length, 5);
  assert.match(blocks[2]!, /^Menurut PopBeez sih/);
  assert.match(blocks[3]!, /^Beezers,/);
});

test("pertanyaan otomatis disapa Beezers kalau model lupa", () => {
  assert.equal(withAudience("Kamu paling nunggu kota mana?"), "Beezers, kamu paling nunggu kota mana?");
  assert.equal(withAudience("Beezers, kamu udah nonton?"), "Beezers, kamu udah nonton?");
  assert.equal(withAudience("  "), "");
});

test("ejaan brand diperbaiki jadi PopBeez", () => {
  assert.equal(normalizeBrand("menurut popbeez sih"), "menurut PopBeez sih");
  assert.equal(normalizeBrand("POPBEEZ rasa gitu"), "PopBeez rasa gitu");
  assert.equal(normalizeBrand("PopBeez emang beda"), "PopBeez emang beda");
});

test("brand ikut dinormalkan di seluruh caption", () => {
  const caption = composeCaption({
    paragraphs: ["PopBeez ngobrolin ini tadi pagi.", "popbeez rasa ini penting."],
    take: "menurut popbeez sih, iya dong.",
    question: "Beezers gimana?",
    hashtags: ["#PopBeez"],
  });
  assert.equal(/popbeez/i.test(caption.replace(/PopBeez/g, "")), false);
});
