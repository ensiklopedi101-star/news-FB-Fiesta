import assert from "node:assert/strict";
import test from "node:test";
import { summarizeFacebookInsights } from "../src/lib/facebook-insights-core";
import {
  buildContentManagerPrompt,
  buildDeterministicPlan,
  DEFAULT_CONTENT_MANAGER_SETTINGS,
  describeSlotContext,
  detectCrossSourceDuplicates,
  validateContentManagerResponse,
  type ContentManagerCandidate,
  type ContentManagerPerformanceSummary,
  type ContentManagerSettings,
} from "../src/lib/content-manager-core";

const candidates: ContentManagerCandidate[] = [
  {
    id: "story-1",
    title: "BTS umumkan comeback album Arirang pada Maret 2026",
    sourceName: "Soompi",
    category: "K-POP",
    pillar: "breaking",
    snippet: "Label mengonfirmasi proyek album baru.",
    isManualPriority: true,
    attempts: 0,
    publishedMinutesAgo: 18,
    imageCount: 2,
  },
  {
    id: "story-2",
    title: "Serial drama Korea Moonlight mencatat rating tertinggi pekan ini",
    sourceName: "Korea Herald",
    category: "DRAMA",
    pillar: "analysis",
    snippet: "Episode terbaru mendorong kenaikan rating.",
    isManualPriority: false,
    attempts: 0,
    publishedMinutesAgo: 42,
    imageCount: 1,
  },
  {
    id: "story-3",
    title: "Webtoon Nara resmi mendapat adaptasi anime dari Studio Aster",
    sourceName: "Anime News",
    category: "MANGA",
    pillar: "manga",
    snippet: "Studio mengumumkan produksi adaptasi.",
    isManualPriority: false,
    attempts: 0,
    publishedMinutesAgo: 65,
    imageCount: 3,
  },
  {
    id: "story-4",
    title: "Festival musik SeoulWave menambah panggung setelah tiket ludes",
    sourceName: "Kpop Daily",
    category: "MUSIK",
    pillar: "community",
    snippet: "Panitia menyiapkan panggung tambahan.",
    isManualPriority: false,
    attempts: 0,
    publishedMinutesAgo: 84,
    imageCount: 2,
  },
  {
    id: "story-5",
    title: "BTS umumkan comeback album Arirang pada Maret 2026 lewat konferensi",
    sourceName: "Yonhap",
    category: "K-POP",
    pillar: "breaking",
    snippet: "Konfirmasi peristiwa album yang sama dari portal berbeda.",
    isManualPriority: false,
    attempts: 0,
    publishedMinutesAgo: 22,
    imageCount: 1,
  },
  {
    id: "story-6",
    title: "Aktor Kim Min-jae bergabung dalam film aksi baru",
    sourceName: "Soompi",
    category: "FILM",
    pillar: "breaking",
    snippet: "Pengumuman casting baru.",
    isManualPriority: false,
    attempts: 1,
    publishedMinutesAgo: 115,
    imageCount: 1,
  },
];

const performance: ContentManagerPerformanceSummary = {
  totalClicks7d: 720,
  publishedPosts7d: 10,
  averageOriginality7d: 81,
  topPillars: [
    { pillar: "manga", clicks: 350, posts: 3 },
    { pillar: "analysis", clicks: 220, posts: 4 },
  ],
  topPerformers: [{ title: "Webtoon Nara resmi mendapat adaptasi anime", pillar: "Manga", clicks: 210 }],
};

test("slot voice follows WITA editorial calendar", () => {
  assert.equal(describeSlotContext("08:30").defaultVoice, "industri");
  assert.equal(describeSlotContext("12:00").defaultVoice, "santai");
  assert.equal(describeSlotContext("15:30").defaultVoice, "penonton");
  assert.equal(describeSlotContext("20:30").defaultVoice, "kritis");
  assert.match(describeSlotContext(null, 13).slotName, /12:00 WITA/);
});

test("cross-source duplicate detector flags same event from another publisher, but not the same publisher", () => {
  const selected = [candidates[0]!];
  const otherSourceDuplicate = { ...candidates[4]!, sourceName: "Yonhap" };
  const sameSourceDuplicate = { ...candidates[4]!, sourceName: "Soompi" };
  assert.deepEqual(detectCrossSourceDuplicates(selected, [selected[0]!, otherSourceDuplicate]), ["story-5"]);
  assert.deepEqual(detectCrossSourceDuplicates(selected, [selected[0]!, sameSourceDuplicate]), []);
});

test("deterministic fallback makes a four-story, diverse plan and keeps a manual priority", () => {
  const plan = buildDeterministicPlan({
    candidates,
    performance,
    activeSlot: "20:30",
    settings: { ...DEFAULT_CONTENT_MANAGER_SETTINGS, focusPillars: ["manga"] },
    recentPublishedTitles: [candidates[1]!.title],
  });
  assert.ok(plan);
  assert.equal(plan.selectedIds.length, 4);
  assert.ok(plan.selectedIds.includes("story-1"));
  assert.ok(!plan.selectedIds.includes("story-2"), "recently covered topics are avoided when other candidates can fill four slots");
  assert.equal(plan.recommendedVoice, "kritis");
  assert.ok(plan.seoKeywords.length > 0);
  assert.ok(plan.duplicateIds.includes("story-5"));
  assert.match(plan.writerBrief, /Prime time malam/);
  assert.equal(new Set(plan.selectedIds).size, 4);
});

test("deterministic fallback relaxes recent-topic avoidance only when four stories cannot otherwise be filled", () => {
  const pool = candidates.slice(0, 4).map((candidate) => ({ ...candidate, isManualPriority: false }));
  const plan = buildDeterministicPlan({
    candidates: pool,
    recentPublishedTitles: pool.map((candidate) => candidate.title),
  });
  assert.ok(plan);
  assert.equal(plan.selectedIds.length, 4);
  assert.deepEqual(new Set(plan.selectedIds), new Set(pool.map((candidate) => candidate.id)));
});

test("model-agnostic prompt includes PopBeez constitution, live directives, metrics, and coded untrusted candidates", () => {
  const settings: ContentManagerSettings = {
    ...DEFAULT_CONTENT_MANAGER_SETTINGS,
    customDirective: "Utamakan pengumuman resmi.",
    focusPillars: ["manga"],
    avoidKeywords: ["rumor"],
    preferredVoice: "penonton",
  };
  const built = buildContentManagerPrompt({
    candidates,
    settings,
    performance,
    recentPublishedTitles: ["Drama terbaru minggu ini"],
    recentDecisionSummaries: ["20:30 · Sorotan drama malam · SEO: K-Drama, BTS"],
    activeSlot: "15:30",
  });
  assert.match(built.prompt, /KONSTITUSI CONTENT MANAGER POPBEEZ/);
  assert.match(built.prompt, /Utamakan pengumuman resmi/);
  assert.match(built.prompt, /720 klik dari 10 post/);
  assert.match(built.prompt, /data sumber tidak tepercaya/);
  assert.match(built.prompt, /MEMORI KEPUTUSAN EDITORIAL DI NEON/);
  assert.match(built.prompt, /Sorotan drama malam/);
  assert.equal(built.codeToId.get("C1"), "story-1");
  assert.equal(built.codeToId.size, candidates.length);
});

test("response validator repairs selection count, enforces manual priority, filters ids and caps duplicate ids", () => {
  const fallback = buildDeterministicPlan({ candidates, activeSlot: "08:30" });
  assert.ok(fallback);
  const { codeToId } = buildContentManagerPrompt({
    candidates,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
    performance: null,
    recentPublishedTitles: [],
    activeSlot: "08:30",
  });
  const raw = JSON.stringify({
    selectedCodes: ["C2", "not-a-candidate", "C3", "C4"],
    duplicateCodes: ["C1", "C5", "C6", "C4", "C2"],
    recommendedVoice: "voice-of-chaos",
    seoKeywords: [" BTS ", "#Arirang", "not-in-source", 4, " "],
    roundupTheme: "**Pekan Pop Culture**",
    writerBrief: "Sorot pengumuman terverifikasi dan konteksnya.",
    editorialReasoning: "Kabar resmi dipilih karena paling relevan.",
  });
  const result = validateContentManagerResponse(raw, {
    candidates,
    codeToId,
    fallbackPlan: fallback,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
  });

  assert.equal(result.selectedIds.length, 4);
  assert.ok(result.selectedIds.includes("story-1"));
  assert.ok(result.selectedIds.every((id) => candidates.some((item) => item.id === id)));
  assert.ok(!result.duplicateIds.includes("story-1"));
  assert.ok(result.duplicateIds.length <= 4);
  assert.equal(result.recommendedVoice, fallback.recommendedVoice);
  assert.ok(result.seoKeywords.includes("BTS"));
  assert.ok(result.seoKeywords.includes("Arirang"));
  assert.ok(result.seoKeywords.length >= 3 && result.seoKeywords.length <= 5);
  assert.equal(result.mode, "ai");
});

test("response validator replaces stories whose topic was published recently", () => {
  const recentTitles = [candidates[1]!.title];
  const fallback = buildDeterministicPlan({ candidates, activeSlot: "12:00", recentPublishedTitles: recentTitles });
  assert.ok(fallback);
  const { codeToId } = buildContentManagerPrompt({
    candidates,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
    performance: null,
    recentPublishedTitles: recentTitles,
    activeSlot: "12:00",
  });
  const result = validateContentManagerResponse(JSON.stringify({
    selectedCodes: ["C1", "C2", "C3", "C4"],
    duplicateCodes: [],
    recommendedVoice: "santai",
    seoKeywords: ["BTS", "Moonlight", "Nara"],
    roundupTheme: "Sorotan pekan ini",
    writerBrief: "Gunakan sudut segar; narasi Reel mengikuti mood santai.",
    editorialReasoning: "Dipilih untuk variasi dan kebaruan.",
  }), {
    candidates,
    codeToId,
    fallbackPlan: fallback,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
    recentPublishedTitles: recentTitles,
  });

  assert.equal(result.selectedIds.length, 4);
  assert.ok(!result.selectedIds.includes("story-2"));
});

test("response validator repairs a carousel containing the same event twice", () => {
  const fallback = buildDeterministicPlan({ candidates, activeSlot: "12:00" });
  assert.ok(fallback);
  const { codeToId } = buildContentManagerPrompt({
    candidates,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
    performance: null,
    recentPublishedTitles: [],
    activeSlot: "12:00",
  });
  const result = validateContentManagerResponse(JSON.stringify({
    selectedCodes: ["C1", "C5", "C2", "C3"],
    duplicateCodes: ["C5"],
    recommendedVoice: "santai",
    seoKeywords: ["BTS", "Moonlight", "Nara"],
    roundupTheme: "Sorotan pekan ini",
    writerBrief: "Gunakan fakta terverifikasi.",
    editorialReasoning: "Kabar ini paling menarik untuk Beezers.",
  }), {
    candidates,
    codeToId,
    fallbackPlan: fallback,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
  });

  assert.equal(result.selectedIds.length, 4);
  assert.equal(new Set(result.selectedIds).size, 4);
  assert.ok(!result.selectedIds.includes("story-5"));
  assert.ok(result.duplicateIds.includes("story-5"));
});

test("response validator rejects unusable model response so provider failover can continue", () => {
  const fallback = buildDeterministicPlan({ candidates, activeSlot: "12:00" });
  assert.ok(fallback);
  const { codeToId } = buildContentManagerPrompt({
    candidates,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
    performance: null,
    recentPublishedTitles: [],
    activeSlot: "12:00",
  });
  assert.throws(() => validateContentManagerResponse("not json", {
    candidates,
    codeToId,
    fallbackPlan: fallback,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
  }), /JSON Content Manager/);
  assert.throws(() => validateContentManagerResponse(JSON.stringify({ selectedCodes: ["C1"] }), {
    candidates,
    codeToId,
    fallbackPlan: fallback,
    settings: DEFAULT_CONTENT_MANAGER_SETTINGS,
  }), /hanya memilih/);
});

test("Facebook Insights adds a sample-qualified pillar signal to deterministic curation", () => {
  const insightPosts = [
    ...["m1", "m2", "m3"].map((facebookPostId) => ({
      facebookPostId,
      title: "Kabar manga",
      pillar: "manga" as const,
      slotLabel: "20:30",
      publishedAt: null,
      syncedAt: "2026-11-10T00:00:00.000Z",
      mediaViews: 120,
      uniqueViewers: 100,
      clicks: 0,
      reactions: 8,
      comments: 1,
      shares: 1,
      videoViews: 0,
      interactionsAvailable: true,
    })),
    ...["a1", "a2"].map((facebookPostId) => ({
      facebookPostId,
      title: "Kabar analisis",
      pillar: "analysis" as const,
      slotLabel: "12:00",
      publishedAt: null,
      syncedAt: "2026-11-10T00:00:00.000Z",
      mediaViews: 105,
      uniqueViewers: 100,
      clicks: 0,
      reactions: 1,
      comments: 0,
      shares: 0,
      videoViews: 0,
      interactionsAvailable: true,
    })),
  ];
  const facebookInsights = summarizeFacebookInsights(insightPosts, { configured: true });
  const candidates: ContentManagerCandidate[] = [
    ["cand-breaking", "breaking"],
    ["cand-analysis", "analysis"],
    ["cand-community", "community"],
    ["cand-list", "list"],
    ["cand-manga", "manga"],
    ["cand-relatable", "relatable"],
  ].map(([id, pillar]) => ({
    id: id!,
    title: `${pillar} event headline ${id}`,
    sourceName: "Source",
    category: "Hiburan",
    pillar: pillar as ContentManagerCandidate["pillar"],
    snippet: "Fakta ringkas.",
    isManualPriority: false,
    attempts: 0,
    publishedMinutesAgo: 10,
    imageCount: 1,
  }));
  const basePerformance: ContentManagerPerformanceSummary = {
    totalClicks7d: 0,
    publishedPosts7d: 0,
    averageOriginality7d: 0,
    topPillars: [],
    topPerformers: [],
  };
  const withoutInsights = buildDeterministicPlan({ candidates, performance: basePerformance });
  const withInsights = buildDeterministicPlan({
    candidates,
    performance: { ...basePerformance, facebookInsights },
  });

  assert.ok(withoutInsights);
  assert.ok(withInsights);
  assert.equal(facebookInsights.postsAnalyzed, 5);
  assert.equal(facebookInsights.topPillars[0]?.pillar, "manga");
  assert.equal(facebookInsights.topPillars[0]?.posts, 3);
  assert.ok(!withoutInsights.selectedIds.includes("cand-manga"));
  assert.ok(withInsights.selectedIds.includes("cand-manga"));
});
