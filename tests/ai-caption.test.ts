import assert from "node:assert/strict";
import test from "node:test";

import { composeCaption, composeRoundupCaption, formatRoundupStories, isUntranslatedRoundupHeadline, normalizeBrand, toFacebookBold, withAudience } from "@/lib/caption";

const paragraphs: [string, string] = [
  "WayV akhirnya buka suara soal rencana tur lintas benua mereka. Kabarnya sih udah disiapin dari tahun lalu.",
  "Yang bikin beda, mereka milih nunggu waktu yang pas ketimbang buru-buru ikut tren.",
];

test("roundup caption titles and summaries remain paired in the supplied article order without markdown asterisks", () => {
  const formatted = formatRoundupStories(
    ["**Judul pertama**", "Judul kedua", "Judul ketiga", "Judul keempat"],
    ["Ringkasan satu", "Ringkasan dua", "Ringkasan tiga", "Ringkasan empat"],
  );
  assert.deepEqual(formatted, [
    `1. ${toFacebookBold("Judul pertama")}\nRingkasan satu`,
    `2. ${toFacebookBold("Judul kedua")}\nRingkasan dua`,
    `3. ${toFacebookBold("Judul ketiga")}\nRingkasan tiga`,
    `4. ${toFacebookBold("Judul keempat")}\nRingkasan empat`,
  ]);
  assert.equal(formatted.some((entry) => /[1-4]️⃣/.test(entry)), false, "nomor caption memakai teks biasa agar warna mengikuti tema Facebook");
  assert.equal(formatted.some((entry) => entry.includes("*")), false);
  assert.throws(() => formatRoundupStories(["Judul"], []), /tepat empat/);
});

test("roundup caption memakai judul bahasa Indonesia tebal Unicode tanpa asterik Markdown", () => {
  const caption = composeRoundupCaption({
    title: "🔥 **POPBEEZ ROUNDUP: Sakamoto Days Tamat hingga P1Harmony Puncaki Billboard &amp; Chart**",
    titles: [
      "Manga Sakamoto Days Resmi Tamat Lewat Chapter Penutup",
      "Album Baru P1Harmony Langsung Melesat ke Puncak Billboard",
      "Drama 100 Days of Deception Kuasai Peringkat Drama Terpopuler",
      "Jujutsu Kaisen Tembus Daftar Bestseller New York Times",
    ],
    summaries: ["Manga ini tamat di chapter 284.", "Album BLOW UP debut di puncak chart.", "Drama tvN ini kembali memuncaki daftar.", "Volume perdana masuk daftar terlaris."],
    take: "Dari kabar penutup manga sampai capaian chart, detail yang paling menarik justru menunjukkan seberapa beragam hal yang sedang diikuti Beezers.",
    question: "Dari 4 kabar ini, mana yang paling bikin kamu antusias?",
    hashtags: ["#PopBeezRoundup", "#SakamotoDays", "#P1Harmony", "#100DaysOfDeception", "#JujutsuKaisen", "#MangaNews"],
  });
  assert.equal(caption.includes("*"), false);
  assert.ok(caption.includes(`2. ${toFacebookBold("Album Baru P1Harmony Langsung Melesat ke Puncak Billboard")}`));
  assert.ok(caption.normalize("NFKC").includes("2. Album Baru P1Harmony Langsung Melesat ke Puncak Billboard"));
  assert.ok(caption.normalize("NFKC").includes("Billboard & Chart"));
  assert.doesNotMatch(caption, /&amp;/i);
  assert.ok(caption.includes("Dari kabar penutup manga sampai capaian chart"));
  assert.doesNotMatch(caption.normalize("NFKC"), /Sweep Top Spots|Ends in Weekly Shonen Jump/);
});

test("guard judul roundup menolak judul RSS bahasa Inggris mentah dan menerima adaptasi bahasa Indonesia", () => {
  const originals = [
    "The Blue Road: Episode 1 (First Impressions)",
    "Bride of the Barrier Master Anime Trailer Reveals Premiere Date, Opening Theme Song",
    "Watch: NCT DREAM Takes 3rd Win For “Boogie Woogie” On “Music Core”; Performances By ITZY’s Chaeryeong, A2O SOUL, And More",
    "“100 Days Of Deception” And “The Perfect Lie” Soar To Their Highest Saturday Ratings Yet",
    "Sakamoto Days Manga Ends in Weekly Shonen Jump",
    "P1Harmony, ILLIT, Stray Kids, xikers, CORTIS, ENHYPEN, IVE, BTS, K/DA, And More Sweep Top Spots On Billboard World Albums Chart",
    "“100 Days Of Deception” And Its Stars Dominate Most Buzzworthy Drama And Actor Rankings",
    "Chainsaw Man, Jujutsu Kaisen, More Manga Rank on NYT November Bestseller List",
    "Dan Da Dan Season 2 Key Visual",
  ];
  for (const original of originals) {
    assert.equal(isUntranslatedRoundupHeadline(original, original), true, original);
  }
  assert.equal(isUntranslatedRoundupHeadline("NCT DREAM Takes 3rd Win For “Boogie Woogie” On “Music Core”", originals[2]), true);
  assert.equal(isUntranslatedRoundupHeadline("The Blue Road Episode 1: Kesan Pertama Kasus Lintas Negara", originals[0]), false);
  assert.equal(isUntranslatedRoundupHeadline("Trailer Anime Bride of the Barrier Master Umumkan Tanggal Tayang dan Lagu Pembuka", originals[1]), false);
  assert.equal(isUntranslatedRoundupHeadline("NCT DREAM Raih Kemenangan Ketiga untuk “Boogie Woogie” di Music Core", originals[2]), false);
  assert.equal(isUntranslatedRoundupHeadline("Drama “100 Days Of Deception” dan “The Perfect Lie” Cetak Rating Sabtu Tertinggi", originals[3]), false);
  assert.equal(isUntranslatedRoundupHeadline("Manga Sakamoto Days Resmi Tamat Lewat Chapter Penutup di Shonen Jump", originals[4]), false);
  assert.equal(isUntranslatedRoundupHeadline("Album Baru P1Harmony “BLOW UP” Langsung Melesat ke Puncak Billboard", originals[5]), false);
  assert.equal(isUntranslatedRoundupHeadline("“100 Days of Deception” Kuasai Peringkat Drama dan Aktor Paling Ramai Dibahas", originals[6]), false);
  assert.equal(isUntranslatedRoundupHeadline("Jujutsu Kaisen dan SPY x FAMILY Tembus Daftar Bestseller New York Times", originals[7]), false);
  assert.equal(
    isUntranslatedRoundupHeadline("Raisa Gelar Konser Tunggal di Stadion Madya Jakarta", "Raisa Gelar Konser Tunggal di Stadion Madya Jakarta"),
    false,
  );
});

test("roundup memakai template tetap dengan judul, pasangan berurutan, CTA, dan hashtag", () => {
  const caption = composeRoundupCaption({
    title: "🔥 POPBEEZ ROUNDUP: Rekor Global Disney+ Hingga Duel Masters Lanjut!",
    titles: ["Berita satu", "Berita dua", "Berita tiga", "Berita empat"],
    summaries: ["Ringkasan satu yang menjelaskan peristiwa dengan detail terverifikasi.", "Ringkasan dua yang menambahkan konteks penting bagi pembaca.", "Ringkasan tiga yang tetap ringan dan jelas.", "Ringkasan empat yang tidak mengulang judul."],
    take: "Empat kabar ini datang dari sisi hiburan yang berbeda, jadi lihat detail tiap pengumuman sebelum menyimpulkan arah trennya.",
    question: "Dari 4 kabar ini, mana yang paling bikin kamu antusias?",
    hashtags: ["#PopBeezRoundup", "#Topik1", "#Topik2", "#Topik3", "#Topik4", "#Update"],
  });
  assert.ok(caption.normalize("NFKC").startsWith("🔥 POPBEEZ ROUNDUP: Rekor Global Disney+ Hingga Duel Masters Lanjut!"));
  assert.ok(caption.includes("Empat kabar ini datang dari sisi hiburan yang berbeda"));
  assert.doesNotMatch(caption, /Beezers, ada 4 kabar panas/);
  assert.ok(caption.indexOf("Ringkasan satu") < caption.indexOf(`2. ${toFacebookBold("Berita dua")}`));
  assert.ok(caption.includes("💬 Beezers, dari 4 kabar ini, mana yang paling bikin kamu antusias?"));
  assert.ok(caption.endsWith("#PopBeezRoundup #Topik1 #Topik2 #Topik3 #Topik4 #Update"));
  assert.equal(caption.includes("*"), false);
  assert.equal(caption.includes("Sudut pandang"), false);
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
