import assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonText,
  GROQ_DEFAULT_ROUNDUP_MAX_TOKENS,
  parseGroqOtpmSafeTokens,
  rankGeminiModels,
  rankGroqModels,
  rankOpenRouterFreeModels,
  OPENROUTER_DEFAULT_ROUNDUP_MAX_TOKENS,
  OPENROUTER_DEFAULT_SINGLE_MAX_TOKENS,
  validateAndRepairDraft,
} from "../src/lib/ai-draft";

test("Groq default roundup max_tokens fits under 1000 OTPM and OTPM parser downshifts safely", () => {
  assert.ok(GROQ_DEFAULT_ROUNDUP_MAX_TOKENS < 1_000);
  const productionError =
    "Request too large for model `qwen/qwen3.8-27b` in organization `org_01m7hf6bgaedp8rve4xp16vvn3` service tier `on_demand` on output tokens per minute (OTPM): Limit 1000, Requested 1600. The request's expected output tokens exceed the enforced limit";
  const safe = parseGroqOtpmSafeTokens(productionError);
  assert.equal(safe, 920);
  assert.equal(parseGroqOtpmSafeTokens("Rate limit reached for RPM"), null);
});

test("rankGeminiModels prioritizes Gemini 3.x flash-lite/flash ahead of legacy 2.5 and drops 2.0/non-text models", () => {
  const ranked = rankGeminiModels([
    "models/gemini-2.0-flash",
    "models/gemini-2.5-flash",
    "models/gemini-2.5-flash-lite",
    "models/gemini-2.5-flash-image",
    "models/gemini-3.1-flash-lite",
    "models/gemini-3.5-flash-lite",
    "models/gemini-embedding-001",
  ]);
  assert.deepEqual(ranked, [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
  ]);
});

test("OpenRouter defaults stay bounded and model discovery only permits free models", () => {
  assert.equal(OPENROUTER_DEFAULT_ROUNDUP_MAX_TOKENS, 1_100);
  assert.equal(OPENROUTER_DEFAULT_SINGLE_MAX_TOKENS, 850);
  const available = [
    "openai/gpt-4o",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free",
    "deepseek/deepseek-r1:free",
    "qwen/qwen-2.5-coder-32b-instruct:free",
    "openrouter/free",
  ];
  const ranked = rankOpenRouterFreeModels(available, "openai/gpt-4o");
  assert.deepEqual(ranked, [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free",
    "openrouter/free",
    "deepseek/deepseek-r1:free",
  ]);
  assert.equal(ranked.some((model) => !model.endsWith(":free") && model !== "openrouter/free"), false);
});

test("rankGeminiModels refuses non-Flash/paid preferences so the free-tier router cannot be forced to a Pro model", () => {
  const ranked = rankGeminiModels(
    ["models/gemini-3-pro", "models/gemini-3.1-flash-lite"],
    "gemini-3-pro",
  );
  assert.deepEqual(ranked, ["gemini-3.1-flash-lite"]);
});

test("rankGroqModels does not misclassify 27b as 7b and excludes guard/whisper models", () => {
  const ranked = rankGroqModels([
    "whisper-large-v3",
    "meta-llama/llama-guard-4-12b",
    "qwen/qwen3.8-27b",
    "llama-3.3-70b-versatile",
    "gemma2-9b-it",
  ]);
  assert.equal(ranked[0], "llama-3.3-70b-versatile");
  assert.ok(ranked.indexOf("gemma2-9b-it") < ranked.indexOf("qwen/qwen3.8-27b"));
  assert.equal(ranked.includes("whisper-large-v3"), false);
});

test("validateAndRepairDraft accepts lean roundup JSON without paragraphs/slidePoints, strips <think>, and repairs minor length/hashtag drift", () => {
  const rawWithThinking = `<think>Mari kita susun 4 berita Bahasa Indonesia dengan rapi.</think>
\`\`\`json
{
  "title": "**Rangkuman Hiburan: Mini Album Luma hingga Panggung Baru PopWave**",
  "roundupTitles": [
    "Grup Fiktif Luma Umumkan Mini Album Lima Lagu",
    "Aktor Raka Perankan Tokoh Utama Serial Misteri Enam Episode",
    "Webtoon Nara Resmi Diadaptasi Jadi Tayangan Animasi",
    "Tiket Ludes, Festival Musik PopWave Siapkan Panggung Tambahan"
  ],
  "roundupSummaries": [
    "Grup Luma memastikan proses rekaman mini album berisi lima lagu telah rampung menjelang perilisan bulan depan.",
    "Aktor Raka memerankan tokoh utama serial misteri enam episode yang melakukan proses syuting di tiga kota berbeda.",
    "Penerbit webtoon populer Nara resmi mengumumkan adaptasi animasi setelah komik tersebut berjalan empat tahun.",
    "${"Panitia festival musik PopWave menambah satu panggung baru setelah tiket awal habis terjual dan akan merilis daftar penampil tambahan pekan depan. ".repeat(2)}"
  ],
  "take": "Menurut PopBeez sih, empat pengumuman ini menarik karena industri musik dan adaptasi komik sama-sama agresif membuka proyek baru.",
  "question": "Beezers, dari keempat pengumuman proyek musik, drama misteri, adaptasi webtoon, sampai festival panggung baru ini, mana yang paling bikin kamu penasaran banget?",
  "narration": "Pendek.",
  "hashtags": ["Luma", "Raka", "WebtoonNara", "PopWave"]
}
\`\`\``;

  assert.ok(extractJsonText(rawWithThinking).startsWith("{"));
  const result = validateAndRepairDraft(rawWithThinking, {
    roundupCount: 4,
    category: "KPOP",
    originalTitles: [
      "Fictional group Luma announces five-track mini album",
      "Actor Raka stars in six-episode mystery series",
      "Webtoon Nara gets anime adaptation",
      "PopWave music festival adds new stage after sellout",
    ],
  });

  assert.equal(result.caption.includes("*"), false);
  assert.equal(result.roundupTitles?.length, 4);
  assert.equal(result.roundupSummaries?.length, 4);
  assert.ok((result.roundupSummaries?.[3]?.length ?? 0) <= 240);
  assert.ok(result.question.length <= 120);
  assert.ok(result.question.endsWith("?"));
  assert.ok(result.narration.length >= 70);
  assert.ok(result.caption.includes("#PopBeezRoundup"));
});

test("validateAndRepairDraft pinpoints English roundup headlines with an explicit field error", () => {
  const raw = JSON.stringify({
    title: "Kabar Hiburan Pekan Ini",
    roundupTitles: [
      "Grup Luma Umumkan Mini Album Baru Bulan Depan",
      "NCT DREAM Takes 3rd Win For Boogie Woogie On Music Core",
      "Webtoon Nara Diadaptasi Jadi Serial Animasi",
      "Festival PopWave Tambah Panggung Baru",
    ],
    roundupSummaries: [
      "Grup Luma menyiapkan mini album berisi lima lagu baru.",
      "NCT DREAM meraih piala ketiga lewat penampilan panggung terbaru.",
      "Webtoon Nara resmi mendapatkan adaptasi animasi baru.",
      "Festival musik PopWave menambah satu panggung tambahan.",
    ],
    take: "Menurut PopBeez sih, kabar ini seru karena jadwal rilisnya padat.",
    question: "Dari 4 kabar ini mana favoritmu?",
    narration: "Beezers, empat kabar hiburan pekan ini hadir mulai dari Luma sampai festival PopWave.",
    hashtags: ["#PopBeezRoundup", "#Luma", "#NCTDream", "#Nara", "#PopWave", "#Musik"],
  });

  assert.throws(
    () => validateAndRepairDraft(raw, { roundupCount: 4 }),
    /roundupTitles\[2\] belum berbahasa Indonesia/,
  );
});
