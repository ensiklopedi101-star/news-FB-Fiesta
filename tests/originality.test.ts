import assert from "node:assert/strict";
import test from "node:test";

import {
  minimumOriginalityScore,
  originalityBlocked,
  originalityLabel,
  originalityMaxAttempts,
  scoreOriginality,
  shouldRetryForOriginality,
  stripHeadlineFromSourceText,
} from "@/lib/originality";

const sourceText =
  "Drama Korea terbaru itu mencatat rating tertinggi sepanjang masa dengan 12,4 persen pada episode terakhirnya. " +
  "Produser menyebut musim kedua sedang dibahas dan pengambilan gambar akan dimulai tahun depan di Seoul.";

test("judul sumber yang sengaja dipertahankan pada roundup tidak dihitung sebagai salinan isi", () => {
  const headline = "Grup fiktif umumkan jadwal tur baru setelah menyelesaikan proses rekaman album studio mereka";
  const scrapedBody = `${headline}. Isi artikel membahas rincian lain yang tidak muncul pada caption redaksi.`;
  const report = scoreOriginality({
    caption: `${headline} — ringkasan redaksi dengan susunan kata yang berbeda.`,
    title: headline,
    sourceText: stripHeadlineFromSourceText(headline, scrapedBody),
  });
  assert.ok(report.longestRun < 8, `longestRun=${report.longestRun}`);
  assert.equal(report.signals.noVerbatim, true);
  assert.match(stripHeadlineFromSourceText(headline, scrapedBody), /Isi artikel membahas rincian lain/);
});

test("caption yang menyalin sumber ditahan", () => {
  const report = scoreOriginality({
    caption: `${sourceText}\n\nMenurut kami drama ini bagus.\n\nKamu sudah menonton?`,
    take: "Menurut kami drama ini bagus.",
    question: "Kamu sudah menonton?",
    sourceText,
  });
  assert.equal(report.signals.noVerbatim, false);
  assert.ok(report.longestRun >= 8, `longestRun=${report.longestRun}`);
  assert.ok(report.matchedPhrase.length > 0);
  assert.equal(report.band, "risky");
  assert.equal(originalityBlocked(report), true);
  assert.match(report.reasons.join(" "), /berurutan/);
});

test("caption dengan analisis, opini, dan pertanyaan spesifik lolos", () => {
  const take =
    "Menurut kami lonjakan rating ini lebih soal kepercayaan penonton lama daripada sensasi cerita barunya, karena pola serupa sudah terlihat di tiga drama kabel yang rilis sebelumnya. Justru keputusan menahan musim kedua sampai naskah matang yang membuat momentum ini bertahan.";
  const question = "Drama apa yang menurutmu paling layak dapat musim kedua dengan perlakuan seperti ini?";
  const report = scoreOriginality({
    caption: [
      "Rating episode pamungkas drama itu tembus dua digit, angka yang jarang muncul di slot akhir pekan.",
      "Kalau dibandingkan drama kabel lain yang rilis di bulan yang sama, kenaikan penontonnya datang dari basis pemirsa lama yang kembali menonton, bukan dari penonton baru.",
      `💡 Sudut pandang PopBeez: ${take}`,
      question,
      "#DramaKorea #RatingDrama #PopBeez",
    ].join("\n\n"),
    take,
    question,
    sourceText,
  });
  assert.equal(report.signals.opinion, true);
  assert.equal(report.signals.analysis, true);
  assert.equal(report.signals.question, true);
  assert.equal(report.signals.noVerbatim, true);
  assert.equal(report.band, "safe");
  assert.equal(originalityBlocked(report), false);
});

test("analisis terlalu pendek tidak dihitung", () => {
  const report = scoreOriginality({
    caption: "Ringkasan singkat berita hiburan hari ini.",
    take: "Menurut kami karena bagus.",
    question: "Bagaimana menurutmu?",
    sourceText,
  });
  assert.ok(report.score <= 65);
  assert.ok(report.reasons.some((reason) => /analisis/i.test(reason)));
});

test("ambang bisa diatur lewat env dan dijepit ke rentang aman", () => {
  assert.equal(minimumOriginalityScore({}), 45);
  assert.equal(minimumOriginalityScore({ ORIGINALITY_MIN_SCORE: "60" }), 60);
  assert.equal(minimumOriginalityScore({ ORIGINALITY_MIN_SCORE: "250" }), 45);
  assert.equal(minimumOriginalityScore({ ORIGINALITY_MIN_SCORE: "abc" }), 45);
});

test("label band dipakai di dashboard", () => {
  assert.equal(originalityLabel("safe"), "Aman");
  assert.equal(originalityLabel("watch"), "Pantau");
  assert.equal(originalityLabel("risky"), "Berisiko");
});

test("draft yang gagal ditulis ulang otomatis, maksimal dua percobaan", () => {
  const blocked = scoreOriginality({
    caption: sourceText,
    take: "",
    question: "",
    sourceText,
  });
  assert.equal(originalityBlocked(blocked), true);
  // First draft may be rewritten once; the second draft is the last chance.
  assert.equal(shouldRetryForOriginality(blocked, 1, 2), true);
  assert.equal(shouldRetryForOriginality(blocked, 2, 2), false);
  // A passing draft is never rewritten, however many attempts are left.
  const safe = scoreOriginality({
    caption: "Menurut kami, karena ceritanya lambat, dampaknya justru pada kesabaran penonton setia yang bertahan sampai akhir musim. Justru itu yang membuat diskusi panjang di media sosial, dibandingkan drama lain yang ramai hanya di episode pembuka. Padahal pola seperti ini sudah berulang sejak tahun lalu, artinya rumah produksi mulai menghitung kesabaran sebagai bagian dari strategi, bukan kelemahan naskah.",
    take: "Menurut kami, karena ceritanya lambat, dampaknya justru pada kesabaran penonton setia yang bertahan sampai akhir musim. Justru itu yang membuat diskusi panjang di media sosial, dibandingkan drama lain yang ramai hanya di episode pembuka.",
    question: "Drama lambat seperti apa yang kamu bertahan sampai episode terakhir?",
    sourceText,
  });
  assert.equal(shouldRetryForOriginality(safe, 1, 2), false);
});

test("jumlah percobaan dijepit 1-2 lewat env", () => {
  assert.equal(originalityMaxAttempts({}), 2);
  assert.equal(originalityMaxAttempts({ ORIGINALITY_MAX_ATTEMPTS: "1" }), 1);
  assert.equal(originalityMaxAttempts({ ORIGINALITY_MAX_ATTEMPTS: "9" }), 2);
  assert.equal(originalityMaxAttempts({ ORIGINALITY_MAX_ATTEMPTS: "0" }), 1);
  assert.equal(originalityMaxAttempts({ ORIGINALITY_MAX_ATTEMPTS: "abc" }), 2);
});
