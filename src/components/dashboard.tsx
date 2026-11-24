"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { facebookPostUrl, isLivePost, splitArticleSections } from "@/lib/article-sections";
import { PILLARS, classifyPillar } from "@/lib/pillars";

type Feed = {
  id: string;
  name: string;
  category: string;
  pageKey: "news" | "entertainment";
  feedUrl: string;
  language: string;
  active: boolean;
  keywords: string[];
  lastFetchedAt: string | null;
  lastError: string | null;
};

type Article = {
  id: string;
  title: string;
  category: string;
  pageKey: "news" | "entertainment";
  sourceName: string;
  sourceUrl: string;
  imageUrl: string | null;
  imageUrls: string[];
  manualImageUrls: string[];
  status: string;
  facebookPostId: string | null;
  errorMessage: string | null;
  createdAt: string;
  sourcePublishedAt: string | null;
  priorityAt: string | null;
  postFormat: "single" | "carousel";
  carouselSlides: string[] | null;
  publishedAt: string | null;
  updatedAt: string;
  queuePosition: number | null;
  /** Analysis + opinion written for this post ("substantial addition"). */
  editorialTake: string | null;
  /** 0–100 originality score; 0 means the post predates the guard. */
  originalityScore: number;
  originalityNotes: { band: "safe" | "watch" | "risky"; reasons: string[]; overlap: number; longestRun: number } | null;
  /** Standing editorial voice that wrote this post. */
  editorialVoice: string | null;
  /** Spoken script for the matching Reel. */
  narrationScript: string | null;
  /** Instagram media id when the post was mirrored to @popbeez.hive. */
  instagramMediaId?: string | null;
};

type ReviewDraftItem = { title: string; rating: string; genre: string; reason: string; suitableFor: string; imageUrl: string };
type ReviewMediaType = "FILM" | "DRAMA" | "MUSIK";

function blankReviewItem(): ReviewDraftItem {
  return { title: "", rating: "", genre: "", reason: "", suitableFor: "", imageUrl: "" };
}

type SystemDiagnostics = {
  checkedAt: string;
  health: {
    level: "healthy" | "warning" | "critical";
    hoursSinceLastPublish: number | null;
    minutesSinceLastCron: number | null;
    minutesSinceLastHarvest: number | null;
    issues: Array<{ code: string; severity: "warning" | "critical"; title: string; detail: string }>;
  };
  heartbeats: {
    lastCronAt: string | null;
    lastCronOutcome: string | null;
    lastCronSummary: string | null;
    lastHarvestAt: string | null;
    lastHarvestOutcome: string | null;
    lastHarvestSummary: string | null;
    lastFeedFetchedAt: string | null;
    lastPublishedAt: string | null;
    lastPublishedTitle: string | null;
  };
  queue: {
    queuedTotal: number;
    queuedEntertainment: number;
    imageEligibleEntertainment: number;
    queuedNews: number;
    processingCount: number;
    expiredLast24h: number;
    failedLast24h: number;
    publisherLockedUntil: string | null;
  };
  cronSetup: {
    appUrl: string | null;
    appUrlHost: string | null;
    shortlinkOnlyHost: string | null;
    harvestEndpoint: string;
    cronEndpoint: string;
  };
  failingFeeds: Array<{
    id: string;
    name: string;
    pageKey: "news" | "entertainment";
    feedUrl: string;
    lastFetchedAt: string | null;
    lastError: string;
  }>;
  failedArticles: Array<{
    id: string;
    title: string;
    sourceName: string;
    pageKey: "news" | "entertainment";
    errorMessage: string;
    attempts: number;
    updatedAt: string;
  }>;
  subsystemErrors: Array<{
    subsystem: "quiz" | "reels" | "instagram-comment";
    title: string;
    errorMessage: string;
    occurredAt: string | null;
  }>;
  recentEvents: Array<{
    id: string;
    source: string;
    trigger: string;
    outcome: string;
    summary: string;
    detail: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

type ContentManagerSettings = {
  enabled: boolean;
  autoArchiveDuplicates: boolean;
  customDirective: string;
  focusPillars: string[];
  avoidKeywords: string[];
  preferredVoice: "auto" | "kritis" | "santai" | "industri" | "penonton";
};

type ContentManagerOverview = {
  schemaReady: boolean;
  settings: ContentManagerSettings;
  performance: {
    totalClicks7d: number;
    publishedPosts7d: number;
    averageOriginality7d: number;
    topPillars: Array<{ pillar: string; clicks: number; posts: number }>;
    topPerformers: Array<{ title: string; pillar: string | null; clicks: number }>;
  };
  eligibleQueueCount: number;
  recentDecisions: Array<{
    id: string;
    mode: string;
    trigger: string;
    provider: string | null;
    model: string | null;
    slotLabel: string | null;
    selectedIds: string[];
    duplicateIds: string[];
    recommendedVoice: string | null;
    seoKeywords: string[];
    roundupTheme: string | null;
    writerBrief: string | null;
    editorialReasoning: string;
    createdAt: string;
  }>;
};

type ContentManagerSimulation = {
  ok: boolean;
  eligibleCount: number;
  error?: string;
  provider?: string | null;
  model?: string | null;
  elapsedMs?: number;
  decision?: {
    mode: string;
    selectedIds: string[];
    duplicateIds: string[];
    recommendedVoice: string;
    seoKeywords: string[];
    roundupTheme: string;
    writerBrief: string;
    editorialReasoning: string;
  };
  selectedArticles?: Array<{ slide: number; id: string; title: string; sourceName: string; category: string; pillar: string }>;
  duplicateArticles?: Array<{ id: string; title: string; sourceName: string }>;
};

type DashboardData = {
  checkedAt: string;
  diagnostics?: SystemDiagnostics | null;
  readyToPublish: boolean;
  integrations: Record<string, boolean>;
  aiModels: { groq: string; gemini: string; openRouter: string };
  contentManager: ContentManagerOverview | null;
  schedule: { maxPerDay: number; maxPerHour: number; minimumGapMinutes: number; harvestEveryHours: number; maxArticlesPerHarvest: number };
  pillars?: { list: Array<{ id: string; label: string; summary: string; share: string }> };
  publishSchedule: { enabled: boolean; active: boolean; graceMinutes: number; slots: string[]; activeSlot: string | null; nextSlot: string | null; minutesUntilNextSlot: number | null };
  originality: { schemaReady: boolean; threshold: number; scored: number; average: number; safe: number; watch: number; risky: number; held: number };
  reels: {
    schemaReady: boolean;
    enabled: boolean;
    published: number;
    last: { videoUrl: string | null; facebookVideoId: string | null; status: string; voiceLabel: string | null; errorMessage: string | null; durationSeconds: number; frameCount: number; createdAt: string } | null;
    minGapHours: number;
    ttsVoice: string;
    renderMode: string;
    voices: Array<{ id: string; label: string; summary: string }>;
  };
  quiz: { lastPostedAt: string | null; lastImageUrl: string | null; lastPostId: string | null; lastError: string | null; tiles: number; maxUses: number; intervalDays: number; schedule: string; schemaReady: boolean };
  stats: { articles: number; publishedToday: number; bufferQueuedToday: number; enabledFeeds: number; totalFeeds: number; queued: number; processing: number; ready: number; published: number; failed: number; expired: number; removed: number };
  feeds: Feed[];
  articles: Article[];
};

type BufferChannel = { id: string; name: string; service: string; type: string; isDisconnected: boolean };
type BufferChannelMapping = { status: "missing-channel-id" | "id-not-found" | "not-a-facebook-page" | "disconnected" | "ready"; channelName?: string };
type AiAttempt = { provider: string; model: string; outcome: "ok" | "failed" | "skipped"; elapsedMs: number; error?: string };
type AiDiagnostic = { ok: boolean; requestId?: string; provider?: string; model?: string; elapsedMs?: number; detail?: string; error?: string; attempts: AiAttempt[] };
type ApiResult = { ok?: boolean; error?: string; result?: string; nextSlot?: string | null; minutesUntilNextSlot?: number | null; titles?: string[]; editionId?: string; imageUrl?: string; detail?: string; title?: string; mediaFormat?: string; provider?: "buffer" | "facebook"; imageUrls?: string[]; videoUrl?: string | null; frames?: number; durationSeconds?: number; added?: number; skipped?: number; inactive?: number; scanned?: number; enriched?: number; imageCandidates?: number; imageBlobStored?: number; limited?: boolean; channels?: BufferChannel[]; mappings?: { news: BufferChannelMapping; entertainment: BufferChannelMapping }; mirrored?: number; failed?: number; results?: Array<{ id: string; title: string; ok: boolean; mediaId?: string; detail?: string }> };

const integrationLabels: Record<string, string> = {
  database: "Neon database",
  schema: "Skema database",
  contentManagerSchema: "Memori Content Manager di Neon",
  feeds: "RSS aktif",
  groq: "Groq AI (utama)",
  gemini: "Gemini AI (cadangan)",
  openRouter: "OpenRouter Free (cadangan)",
  bufferApi: "Buffer API key",
  bufferNews: "Channel Buffer berita",
  bufferEntertainment: "Channel Buffer hiburan",
  facebookEntertainment: "Facebook Graph PopBeez",
  instagram: "Instagram @popbeez.hive",
  instagramSchema: "Kolom Instagram (migrasi 0013)",
  appUrl: "URL publik aplikasi",
  cronSecret: "Pengaman cron",
  blobStorage: "Penyimpanan gambar Blob",
};

function formatDate(value: string | null) {
  if (!value) return "Belum pernah";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function pageLabel(pageKey: Feed["pageKey"]) {
  return pageKey === "news" ? "Berita" : "Hiburan";
}

function buildExternalReelPrompt(article: Article): string {
  const narration = article.narrationScript?.trim() || article.editorialTake?.trim() || "";
  const source = article.sourceUrl?.trim() || "Tidak tersedia";
  return `Buat konsep dan video Reel untuk PopBeez berdasarkan artikel ini.\n\nJUDUL ARTIKEL: ${article.title}\nKATEGORI: ${article.category || "Hiburan"}\nSUMBER: ${article.sourceName || "Tidak diketahui"}\nTAUTAN SUMBER: ${source}\n\nNASKAH NARASI (gunakan persis; jangan menambah fakta):\n${narration}\n\nARAHAN PRODUKSI:\n- Format vertikal 9:16, resolusi 1080x1920, durasi sekitar 25–35 detik.\n- Susun visual mengikuti urutan narasi; pembuka harus menarik dalam 2 detik pertama, lalu tutup dengan pertanyaan atau ajakan diskusi yang sudah ada di naskah.\n- Gunakan Bahasa Indonesia untuk narasi dan subtitle. Jangan ubah makna, nama, angka, atau kutipan dalam naskah. Jangan mengarang fakta atau menampilkan klaim yang tidak didukung artikel.\n- Buat visual orisinal atau gunakan aset yang memang berlisensi. Jangan mengambil klip film/drama, foto selebritas, cuplikan acara, logo, atau musik berhak cipta tanpa izin. Jika visual nyata tidak tersedia, gunakan ilustrasi, tipografi sederhana, atau B-roll netral yang relevan; jangan menyamar sebagai rekaman kejadian nyata.\n- Jangan menggambar logo atau teks brand dengan AI. Sisakan ruang aman di bagian atas dan bawah untuk ditambahkan saat editing: logo lingkaran PopBeez, @popbeez.hive, kredit sumber, dan tulisan “powered by HIVECOMP”. Jangan tutupi elemen penting dengan subtitle.\n- Hasil akhir yang diinginkan: MP4 vertikal siap ditinjau redaksi. Sertakan juga daftar adegan singkat bila alat tidak dapat menghasilkan video langsung.\n\nSebelum dipublikasikan, cocokkan kembali isi video dengan artikel dan pastikan semua aset boleh digunakan.`;
}

function voiceLabelOf(article: Article) {
  const label = article.editorialVoice;
  if (!label) return "PopBeez";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function articleStatusLabel(article: Article) {
  if (article.status === "ready" && article.facebookPostId?.startsWith("buffer:pending:")) return "Perlu cek Buffer";
  if (article.status === "ready" && article.facebookPostId?.startsWith("facebook:pending:")) return "Perlu cek Facebook";
  if (article.status === "ready" && article.facebookPostId?.startsWith("buffer:")) return "Antrean Buffer";
  if (article.status === "ready") return "Siap";
  if (article.status === "queued") return "Antre";
  if (article.status === "processing") return "Sedang dikirim";
  if (article.status === "published") return "Terbit";
  if (article.status === "expired") return "Kedaluwarsa";
  if (article.status === "removed") return "Dihapus";
  return article.status;
}

function bufferMappingLabel(mapping: BufferChannelMapping) {
  switch (mapping.status) {
    case "ready": return `Terhubung: ${mapping.channelName}`;
    case "missing-channel-id": return "ID channel belum diatur di Vercel";
    case "id-not-found": return "ID tidak ditemukan untuk API key ini";
    case "not-a-facebook-page": return `Bukan Facebook Page: ${mapping.channelName}`;
    case "disconnected": return `Channel terputus: ${mapping.channelName}`;
  }
}

type DashboardTab = "overview" | "contentManager" | "diagnostics" | "queue" | "published" | "feeds" | "manual" | "quiz" | "reels" | "originality" | "setup";

const DASHBOARD_TABS: Array<{ key: DashboardTab; label: string }> = [
  { key: "overview", label: "Ringkasan" },
  { key: "contentManager", label: "Content Manager" },
  { key: "diagnostics", label: "Diagnostik & Error" },
  { key: "queue", label: "Antrean" },
  { key: "published", label: "Sudah terbit" },
  { key: "feeds", label: "Feed RSS" },
  { key: "manual", label: "Konten manual" },
  { key: "quiz", label: "Kuis" },
  { key: "reels", label: "Reels" },
  { key: "originality", label: "Orisinalitas" },
  { key: "setup", label: "Setup API" },
];

const TAB_STORAGE_KEY = "popbeez-dashboard-tab";

/** One line under the tab bar so each tab explains itself without scrolling. */
const TAB_HINTS: Record<DashboardTab, string> = {
  overview: "Statistik, kesiapan layanan, kuota harian, dan jadwal slot tayang.",
  contentManager: "Atur strategi PopBeez, lihat performa klik, simulasi kurasi editorial, dan jejak keputusan agent.",
  diagnostics: "Pantau error sistem, detak cron & panen RSS otomatis, kegagalan feed/AI/publikasi, dan ekspor laporan diagnostik.",
  queue: "Artikel yang masih menunggu dikirim. Maksimal 4 post/hari (pagi · siang · sore · malam) dengan pilar yang bergantian.",
  published: "Post yang sudah keluar dari antrean: terbit, menunggu slot Buffer, atau gagal.",
  feeds: "Sumber RSS untuk halaman Berita dan Hiburan.",
  manual: "Susun review mingguan enam slide sendiri.",
  quiz: "Kuis Tebak Drama dari poster review manual.",
  reels: "Pilih artikel hiburan dan salin prompt untuk membuat video dengan AI lain; render otomatis tersedia jika encoder disetel.",
  originality: "Penjaga orisinalitas: skor, opini redaksi, dan post yang ditahan.",
  setup: "Daftar environment variable, tes AI, dan tes Buffer.",
};

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [contentManagerDraft, setContentManagerDraft] = useState<ContentManagerSettings | null>(null);
  const [contentManagerSimulation, setContentManagerSimulation] = useState<ContentManagerSimulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("BALI");
  const [pageKey, setPageKey] = useState<Feed["pageKey"]>("news");
  const [feedUrl, setFeedUrl] = useState("");
  const [language, setLanguage] = useState("id");
  const [keywords, setKeywords] = useState("");
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>([]);
  const [bufferMappings, setBufferMappings] = useState<ApiResult["mappings"]>(undefined);
  const [aiDiagnostic, setAiDiagnostic] = useState<AiDiagnostic | null>(null);
  const [systemDiagnostics, setSystemDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);
  const [imageDrafts, setImageDrafts] = useState<Record<string, string>>({});
  const [reelPromptArticleId, setReelPromptArticleId] = useState("");
  const [reelPromptCopied, setReelPromptCopied] = useState(false);
  const [reviewHeadline, setReviewHeadline] = useState("");
  const [reviewMediaType, setReviewMediaType] = useState<ReviewMediaType>("DRAMA");
  const [reviewItems, setReviewItems] = useState<ReviewDraftItem[]>(() => Array.from({ length: 5 }, blankReviewItem));

  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${secret}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ApiResult & Partial<DashboardData>;
    if (!response.ok) throw new Error(result.error || result.detail || `Permintaan gagal (HTTP ${response.status}).`);
    return result;
  }, [secret]);

  const refresh = useCallback(async () => {
    const result = await api("/api/dashboard");
    const dashboard = result as DashboardData;
    setData(dashboard);
    if (dashboard.contentManager) {
      setContentManagerDraft((current) => current ?? dashboard.contentManager!.settings);
    }
    setAuthenticated(true);
    return dashboard;
  }, [api]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tidak dapat membuka dashboard.");
    } finally {
      setBusy(false);
    }
  }

  // Remember the open tab so a refresh does not drop the user back to Ringkasan.
  useEffect(() => {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    if (stored && DASHBOARD_TABS.some((tab) => tab.key === stored)) setActiveTab(stored as DashboardTab);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => {
      void refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Gagal memuat ulang dashboard."));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [authenticated, refresh]);

  async function addFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/feeds", {
        method: "POST",
        body: JSON.stringify({ name, category, pageKey, feedUrl, language, keywords: keywords.split(",").map((item) => item.trim()).filter(Boolean) }),
      });
      setName("");
      setFeedUrl("");
      setKeywords("");
      setMessage("Feed ditambahkan. Kamu bisa menonaktifkan atau menghapusnya kapan saja.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menambahkan feed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFeed(feed: Feed) {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/feeds", { method: "PATCH", body: JSON.stringify({ id: feed.id, active: !feed.active }) });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal mengubah feed.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFeed(feed: Feed) {
    if (!window.confirm(`Hapus feed “${feed.name}”? Artikel yang sudah tersimpan tidak ikut terhapus.`)) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/feeds", { method: "DELETE", body: JSON.stringify({ id: feed.id }) });
      setMessage("Feed dihapus.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menghapus feed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveManualImages(event: FormEvent<HTMLFormElement>, article: Article) {
    event.preventDefault();
    const imageUrls = (imageDrafts[article.id] ?? article.manualImageUrls.join("\n"))
      .split(/\n+/).map((url) => url.trim()).filter(Boolean);
    if (imageUrls.length > 2) {
      setMessage("Maksimal dua tautan gambar untuk satu postingan.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/articles/images", {
        method: "PATCH",
        body: JSON.stringify({ id: article.id, imageUrls }),
      });
      setMessage(imageUrls.length ? `Tautan gambar manual disimpan (${imageUrls.length}).` : "Gambar manual dihapus; gambar RSS akan digunakan lagi saat tersedia.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menyimpan tautan gambar.");
    } finally {
      setBusy(false);
    }
  }

  async function submitManualReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Review ini akan diterbitkan ke halaman PopBeez. Tautan mengikuti aturan komentar pertama. Pastikan rating dan semua informasi sudah benar. Lanjutkan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/admin/manual-review", {
        method: "POST",
        body: JSON.stringify({
          headline: reviewHeadline,
          mediaType: reviewMediaType,
          items: reviewItems.map((item) => ({ ...item, rating: Number(item.rating) })),
        }),
      });
      setMessage(result.error
        ? `Status publikasi belum pasti: ${result.error}`
        : result.provider === "facebook"
          ? `Review “${result.title ?? reviewHeadline}” langsung diterbitkan ke halaman Facebook PopBeez.`
          : result.mediaFormat === "single"
            ? "Review tersimpan, tetapi Buffer hanya menerima cover satu gambar. Periksa batas carousel channel Buffer."
            : `Review “${result.title ?? reviewHeadline}” masuk ke antrean Buffer dalam format carousel enam slide.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membuat review manual.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function removeArticle(article: Article) {
    if (!window.confirm(`Keluarkan “${article.title}” dari antrean? Berita ini tidak akan diproses, tetapi catatannya tetap tersimpan.`)) return;
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/articles", { method: "DELETE", body: JSON.stringify({ id: article.id }) });
      setMessage("Berita dikeluarkan dari antrean.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal mengeluarkan berita dari antrean.");
    } finally {
      setBusy(false);
    }
  }

  async function retrySourceComment(article: Article) {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/retry-comment", { method: "POST", body: JSON.stringify({ id: article.id }) });
      setMessage("Komentar sumber berhasil dikirim ulang.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal mengirim ulang komentar sumber.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function mirrorArticleToInstagram(article: Article) {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/admin/instagram-mirror", { method: "POST", body: JSON.stringify({ id: article.id }) });
      const outcome = result.results?.[0];
      setMessage(outcome?.ok
        ? `Post dicerminkan ke Instagram: ${article.title}.`
        : `Instagram belum berhasil: ${outcome?.detail || result.error || "lihat pesan di baris artikel."}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal mencerminkan post ke Instagram.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function createReel() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/reels", { method: "POST" });
      setMessage(result.result === "published"
        ? `Reel terbit: ${result.frames ?? 0} frame · ${result.durationSeconds ?? 0} detik${result.videoUrl ? ` · ${result.videoUrl}` : ""}`
        : result.detail || "Tidak ada Reel yang dibuat.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membuat Reel.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function copyReelPrompt(article: Article) {
    try {
      await navigator.clipboard.writeText(buildExternalReelPrompt(article));
      setReelPromptCopied(true);
    } catch {
      setReelPromptCopied(false);
    }
  }

  async function requeueArticle(article: Article) {
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/retry", { method: "POST", body: JSON.stringify({ id: article.id }) });
      setMessage(`Masuk antrean lagi: ${article.title}. Caption akan ditulis ulang pada siklus publisher berikutnya.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memasukkan artikel kembali ke antrean.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function toggleArticlePriority(article: Article) {
    const priority = !article.priorityAt;
    setBusy(true);
    setMessage("");
    try {
      await api("/api/admin/articles", {
        method: "PATCH",
        body: JSON.stringify({ id: article.id, priority }),
      });
      setMessage(priority
        ? "Prioritas diperbarui. Berita ini menjadi item antrean lokal berikutnya yang akan dikirim ke Buffer."
        : "Prioritas berita dibatalkan.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memperbarui prioritas berita.");
    } finally {
      setBusy(false);
    }
  }

  async function createQuizEdition() {
    if (!window.confirm("Kuis Tebak Drama akan langsung diposting ke halaman Facebook PopBeez. Lanjutkan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/quiz", { method: "POST" });
      setMessage(result.result === "posted"
        ? `Kuis terbit dengan ${result.titles?.length ?? 12} poster.`
        : result.detail || "Kuis diproses.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membuat kuis.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function importPresets() {
    if (!window.confirm("Masukkan preset sumber hiburan? Feed Google News dan HanCinema akan ditambahkan dalam keadaan nonaktif untuk ditinjau.")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/admin/feeds/import-presets", { method: "POST" });
      setMessage(`Preset selesai: ${result.added ?? 0} ditambahkan, ${result.skipped ?? 0} sudah ada. ${result.inactive ?? 0} feed perlu ditinjau/diaktifkan manual.`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memasukkan preset feed.");
    } finally {
      setBusy(false);
    }
  }

  async function loadBufferChannels() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/admin/buffer/channels");
      setBufferChannels(result.channels ?? []);
      setBufferMappings(result.mappings);
      const newsStatus = result.mappings?.news ? bufferMappingLabel(result.mappings.news) : "belum diperiksa";
      const entertainmentStatus = result.mappings?.entertainment ? bufferMappingLabel(result.mappings.entertainment) : "belum diperiksa";
      setMessage(`Koneksi Buffer berhasil dibaca. Berita: ${newsStatus}. Hiburan: ${entertainmentStatus}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal membaca channel Buffer.");
    } finally {
      setBusy(false);
    }
  }

  async function testAiConnection() {
    setBusy(true);
    setMessage("");
    setAiDiagnostic(null);
    try {
      const response = await fetch("/api/admin/diagnostics/ai", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as AiDiagnostic;
      setAiDiagnostic(result);
      if (!response.ok || !result.ok) throw new Error(result.error || `Tes AI gagal (HTTP ${response.status}).`);
      setMessage(`Tes AI berhasil: ${result.provider} · ${result.model} · ${result.elapsedMs} ms. Tidak ada konten yang dipublikasikan.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tes koneksi AI gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContentManagerSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contentManagerDraft) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/admin/content-manager", {
        method: "PUT",
        body: JSON.stringify(contentManagerDraft),
      }) as unknown as { settings: ContentManagerSettings };
      if (result.settings) setContentManagerDraft(result.settings);
      setMessage("Strategi dan preferensi Content Manager tersimpan di Neon.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menyimpan pengaturan Content Manager.");
    } finally {
      setBusy(false);
    }
  }

  async function simulateContentManager() {
    setBusy(true);
    setMessage("");
    setContentManagerSimulation(null);
    try {
      const result = await api("/api/admin/content-manager", { method: "POST" }) as unknown as ContentManagerSimulation;
      setContentManagerSimulation(result);
      setMessage(result.ok
        ? `Simulasi selesai melalui ${result.provider ?? "Fallback deterministik"}${result.model ? ` · ${result.model}` : ""}. Tidak ada artikel yang diubah atau diterbitkan.`
        : result.error ?? "Belum cukup kandidat untuk simulasi.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Simulasi Content Manager gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function harvestNow() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/harvest?manual=1", { method: "POST" });
      const cap = result.limited ? " Batas panen 50 artikel tercapai." : "";
      setMessage(`Panen selesai: ${result.scanned ?? 0} item diperiksa, ${result.added ?? 0} artikel baru masuk antrean, ${result.enriched ?? 0} diperkaya dari halaman sumber; foto terdeteksi ${result.imageCandidates ?? 0}, tersimpan ke Blob ${result.imageBlobStored ?? 0}.${cap}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Panen RSS gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function runSystemCheck(options?: { runHarvest?: boolean; probeAi?: boolean }) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/diagnostics/system", {
        method: options?.runHarvest || options?.probeAi ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(options?.runHarvest || options?.probeAi ? { "Content-Type": "application/json" } : {}),
        },
        ...(options?.runHarvest || options?.probeAi ? { body: JSON.stringify(options) } : {}),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        error?: string;
        diagnostics?: SystemDiagnostics;
        harvestResult?: { added?: number; scanned?: number; feedsFailed?: number; feedsTotal?: number; error?: string } | null;
        aiResult?: AiDiagnostic | null;
      };
      if (!response.ok || !payload.ok || !payload.diagnostics) {
        throw new Error(payload.error || `Diagnostik gagal (HTTP ${response.status}).`);
      }
      setSystemDiagnostics(payload.diagnostics);
      if (payload.aiResult) setAiDiagnostic(payload.aiResult);
      await refresh();
      const notes: string[] = [`Diagnostik diperbarui (${payload.diagnostics.health.issues.length} temuan)`];
      if (payload.harvestResult) {
        notes.push(
          payload.harvestResult.error
            ? `Panen gagal: ${payload.harvestResult.error}`
            : `Panen RSS: +${payload.harvestResult.added ?? 0} baru dari ${payload.harvestResult.scanned ?? 0} item`,
        );
      }
      if (payload.aiResult) {
        notes.push(
          payload.aiResult.ok
            ? `AI aktif (${payload.aiResult.provider} · ${payload.aiResult.model})`
            : `AI gagal (${payload.aiResult.error ?? "error"})`,
        );
      }
      setMessage(`${notes.join(" · ")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal menjalankan diagnostik sistem.");
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnosticsReport() {
    const activeDiag = systemDiagnostics ?? data?.diagnostics ?? null;
    if (!activeDiag) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(activeDiag, null, 2));
      setDiagCopied(true);
      window.setTimeout(() => setDiagCopied(false), 2_500);
    } catch {
      setMessage("Gagal menyalin laporan ke clipboard.");
    }
  }

  async function requeueAllFailedArticles() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/retry", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bulk: true }),
        cache: "no-store",
      });
      const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || `Gagal memulihkan antrean (HTTP ${response.status}).`);
      }
      setMessage(result.message || "Artikel gagal dikembalikan ke antrean.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Gagal memulihkan artikel gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function publishOne() {
    if (!window.confirm("Ini akan menerbitkan satu artikel sungguhan ke halaman tujuan. Posting langsung terbit di Facebook; jika memakai Buffer, post masuk antrean sesuai jadwal channel. Lanjutkan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/cron?force=1");
      setMessage(result.result === "published" && result.title ? `Terbit di Facebook: ${result.title}` : result.result === "queued" && result.title ? `Masuk antrean Buffer: ${result.title}` : result.result === "outside-slot" ? (result.detail ?? "Di luar jadwal tayang.") : result.title ? `Berhasil diproses: ${result.title}` : result.detail || "Siklus selesai.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pipeline gagal.");
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!authenticated) {
    return (
      <main className="dashboard-shell login-shell">
        <header className="dashboard-header"><div className="brand-mark">N</div><div><strong>News FB Fiesta</strong><span>Dashboard redaksi</span></div></header>
        <section className="login-card">
          <p className="eyebrow">AKSES ADMIN</p>
          <h1>Kelola feed dan pantau sistem.</h1>
          <p>Masukkan nilai <code>CRON_SECRET</code> yang tersimpan di Vercel. Kunci ini hanya digunakan dari browser untuk mengakses dashboard; jangan bagikan ke orang lain.</p>
          <form onSubmit={unlock} className="login-form">
            <label htmlFor="admin-secret">Kunci admin</label>
            <input id="admin-secret" type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} required placeholder="CRON_SECRET" />
            <button className="primary-button" type="submit" disabled={busy || !secret}>{busy ? "Memeriksa…" : "Buka dashboard"}</button>
          </form>
          {message && <p className="notice error-notice">{message}</p>}
          <small className="muted">Belum mengatur CRON_SECRET? Tambahkan di Vercel → Settings → Environment Variables, lalu deploy ulang.</small>
        </section>
        <footer className="dashboard-footer">Berita dan hiburan dipisahkan berdasarkan tujuan publikasi. Rahasia API tidak disimpan di browser.</footer>
      </main>
    );
  }

  const checks = data?.integrations ?? {};
  const feedPages = new Set(data?.feeds.filter((feed) => feed.active).map((feed) => feed.pageKey) ?? []);
  const canPublish = Boolean(data?.readyToPublish);
  const publishSchedule = data?.publishSchedule;
  const sections = splitArticleSections(data?.articles ?? []);
  const liveCount = sections.done.filter((article) => isLivePost(article.status)).length;
  const failedCount = sections.done.filter((article) => article.status === "failed").length;
  const waitingSlotCount = sections.done.length - liveCount - failedCount;

  function renderArticleCard(article: Article) {
    // Rows created before the brand fix still say "Popbeez".
    const isManualReview = /^review manual popbeez$/i.test(article.sourceName.trim());
    const previewSlides = isManualReview && article.postFormat === "carousel" ? [1, 2, 3, 4, 5, 6] : article.postFormat === "carousel" && article.carouselSlides?.length === 3 ? [1, 2, 3, 4] : [1];
    const slideTotal = isManualReview ? 6 : 4;
    const postUrl = facebookPostUrl(article.facebookPostId);
    const commentFailed = article.status === "published" && Boolean(article.errorMessage?.startsWith("Posting berhasil; komentar sumber gagal:"));
    return (
      <article className="article-row" key={article.id}>
        <div className="article-row-top">
          {article.queuePosition && <span className="queue-position">#{article.queuePosition}</span>}
          {article.status === "queued" && article.priorityAt && <span className="status-tag priority">PRIORITAS</span>}
          <span className={`tag ${article.pageKey}`}>{pageLabel(article.pageKey)}</span>
          <span className={`status-tag ${article.status}`}>{articleStatusLabel(article)}</span>
          <span className={`format-tag ${article.postFormat}`}>{isManualReview ? article.postFormat === "carousel" ? "Review · 6 slide" : "Review · cover saja" : article.postFormat === "carousel" ? "Carousel · 4 slide" : "Satu gambar"}</span>
          {!isManualReview && <span className="status-tag pillar-tag" title={PILLARS[classifyPillar(article)].summary}>{PILLARS[classifyPillar(article)].label}</span>}
          {article.editorialVoice && <span className="status-tag voice-tag">{voiceLabelOf(article)}</span>}
          {article.originalityScore > 0 && <span className={`status-tag originality-${article.originalityNotes?.band ?? "watch"}`} title={article.originalityNotes?.reasons.join(" ") ?? ""}>Orisinalitas {article.originalityScore}</span>}
          {article.status === "queued" && <button type="button" className="quiet-button priority-button" disabled={busy} onClick={() => void toggleArticlePriority(article)}>{article.priorityAt ? "Batalkan prioritas" : "Jadikan prioritas"}</button>}
          {article.status === "queued" && <button type="button" className="danger-button article-remove" disabled={busy} onClick={() => void removeArticle(article)}>Hapus dari antrean</button>}
          {commentFailed && <button type="button" className="retry-comment-button" disabled={busy} onClick={() => void retrySourceComment(article)}>Kirim ulang komentar sumber</button>}
          {checks.instagram && article.status === "published" && !article.instagramMediaId && (
            <button type="button" className="quiet-button" disabled={busy} onClick={() => void mirrorArticleToInstagram(article)}>Mirror ke Instagram</button>
          )}
          {article.status === "failed" && <button type="button" className="quiet-button" disabled={busy} onClick={() => void requeueArticle(article)}>Tulis ulang caption</button>}
        </div>
        <strong>{article.title}</strong>
        <div className="article-meta">{article.sourceName} · {article.category} · {article.sourcePublishedAt ? "Terbit sumber" : "Masuk antrean (perkiraan)"}: {formatDate(article.sourcePublishedAt || article.createdAt)}</div>
        {article.status === "published" && <div className="article-meta published-meta">Terbit di Facebook: {formatDate(article.publishedAt)}</div>}
        {article.status === "ready" && <div className="article-meta published-meta">Dikirim: {formatDate(article.updatedAt)}</div>}
        {article.editorialTake && <p className="article-take">{article.editorialTake}</p>}
        {article.narrationScript && <details className="article-narration"><summary>Naskah narasi Reel</summary><p>{article.narrationScript}</p></details>}
        {article.errorMessage && <p className="article-error">{article.errorMessage}</p>}
        <div className={`article-card-preview ${article.postFormat === "carousel" ? "carousel-preview" : ""}`}>
          <div className="article-preview-gallery">
            {previewSlides.map((slideNumber) => {
              const hasSlides = isManualReview ? article.postFormat === "carousel" : article.postFormat === "carousel" && article.carouselSlides?.length === 3;
              const slideUrl = hasSlides ? `/api/og/${article.id}?slide=${slideNumber}` : `/api/og/${article.id}`;
              return <a href={slideUrl} target="_blank" rel="noreferrer" key={slideNumber} aria-label={`Buka slide ${slideNumber} news card: ${article.title}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slideUrl} alt={`Pratinjau slide ${slideNumber}: ${article.title}`} loading="lazy" />
                {hasSlides && <span>{slideNumber}/{slideTotal}</span>}
              </a>;
            })}
          </div>
          <div className="article-card-details">
            <strong className={article.imageUrl ? "image-status present" : "image-status missing"}>{article.imageUrl ? `${article.imageUrls?.length ?? 1} foto sumber terdeteksi` : "Belum ada gambar sumber"}</strong>
            {!isManualReview && article.postFormat === "carousel" && article.carouselSlides?.length !== 3 && <small className="muted">Empat slide dibuat saat berita diproses.</small>}
            <a className="article-source" href={`/api/og/${article.id}`} target="_blank" rel="noreferrer">Buka news card ukuran penuh ↗</a>
            {article.imageUrl && <a className="article-source" href={article.imageUrl} target="_blank" rel="noreferrer">Buka foto sumber ↗</a>}
          </div>
        </div>
        {article.status === "queued" && !isManualReview && <form className="manual-image-form" onSubmit={(event) => void saveManualImages(event, article)}>
          <label>Gambar untuk news card (maksimal 2 URL HTTPS, satu per baris)<textarea value={imageDrafts[article.id] ?? article.manualImageUrls.join("\n")} onChange={(event) => setImageDrafts((current) => ({ ...current, [article.id]: event.target.value }))} rows={2} placeholder="https://.../gambar-1.jpg&#10;https://.../gambar-2.jpg" /></label>
          <button type="submit" className="secondary-button" disabled={busy}>Simpan gambar manual</button>
        </form>}
        <div className="article-links">
          <a className="article-source" href={article.sourceUrl} target="_blank" rel="noreferrer">Buka artikel sumber ↗</a>
          {article.status === "published" && postUrl && <a className="article-source" href={postUrl} target="_blank" rel="noreferrer">Buka post Facebook ↗</a>}
          {article.instagramMediaId && <a className="article-source" href={`https://www.instagram.com/p/${article.instagramMediaId}/`} target="_blank" rel="noreferrer">Buka post Instagram ↗</a>}
        </div>
      </article>
    );
  }

  const reelPromptArticles = (data?.articles ?? []).filter((article) =>
    article.pageKey === "entertainment" &&
    Boolean(article.narrationScript?.trim()) &&
    (article.status === "published" || article.status === "ready"),
  );
  const selectedReelPromptArticle = reelPromptArticles.find((article) => article.id === reelPromptArticleId) ?? reelPromptArticles[0];
  const activeDiagnostics = systemDiagnostics ?? data?.diagnostics ?? null;
  const diagIssueCount = activeDiagnostics?.health.issues.length ?? 0;

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-mark">N</div>
        <div className="header-title"><strong>News FB Fiesta v3.0</strong><span>Smart Content Manager · Multi-Free-AI</span></div>
        <div className="header-right"><span className={canPublish ? "system-pill ready" : "system-pill pending"}>{canPublish ? "SIAP PUBLIKASI" : "SETUP BELUM LENGKAP"}</span><button className="quiet-button" onClick={() => { setAuthenticated(false); setData(null); setContentManagerDraft(null); setContentManagerSimulation(null); setSystemDiagnostics(null); setSecret(""); }}>Keluar</button></div>
      </header>

      <section className="dashboard-intro">
        <div><p className="eyebrow">RINGKASAN SISTEM</p><h1>Dashboard redaksi</h1><p>Pilih tab di bawah: diagnostik error, antrean, feed RSS, konten manual, kuis, Reels, dan setup API dipisah supaya tidak perlu scroll panjang.</p></div>
        <div className="updated-at">Diperbarui {formatDate(data?.checkedAt ?? null)}</div>
      </section>

      {message && <div className="notice">{message}</div>}

      <nav className="dashboard-tabs" role="tablist" aria-label="Bagian dashboard">
        {DASHBOARD_TABS.map((tab) => {
          const badge = tab.key === "diagnostics" ? diagIssueCount
            : tab.key === "contentManager" ? (data?.contentManager?.eligibleQueueCount ?? 0)
            : tab.key === "queue" ? sections.queue.length
            : tab.key === "published" ? sections.done.length
            : tab.key === "feeds" ? (data?.feeds.length ?? 0)
            : null;
          const alert = (tab.key === "published" && failedCount > 0) || (tab.key === "diagnostics" && diagIssueCount > 0);
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`tab-button ${activeTab === tab.key ? "active" : ""}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              {badge !== null && <b className={`tab-badge ${alert ? "alert" : ""}`}>{badge}</b>}
            </button>
          );
        })}
      </nav>

      <p className="tab-hint">{TAB_HINTS[activeTab]}</p>

      {activeTab === "overview" && (<>
      {activeDiagnostics && activeDiagnostics.health.issues.length > 0 && (
        <div className={`diagnostic-result ${activeDiagnostics.health.level === "healthy" ? "success" : "failure"}`} style={{ marginBottom: 14 }}>
          <strong>
            {activeDiagnostics.health.level === "critical"
              ? `Perhatian Otomasi (${activeDiagnostics.health.issues.length} temuan kritis/peringatan)`
              : `Catatan Otomasi (${activeDiagnostics.health.issues.length} peringatan)`}
          </strong>
          <span>{activeDiagnostics.health.issues[0]?.title}: {activeDiagnostics.health.issues[0]?.detail}</span>
          <div className="diagnostic-actions">
            <button type="button" className="secondary-button" onClick={() => setActiveTab("diagnostics")}>Buka Diagnostik &amp; Error →</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void runSystemCheck({ runHarvest: true, probeAi: false })}>{busy ? "Memproses…" : "Panen RSS sekarang"}</button>
          </div>
        </div>
      )}
      <section className="stat-grid" aria-label="Statistik artikel">
        <article className="stat-card"><span>Total artikel tersimpan</span><strong>{data?.stats.articles ?? 0}</strong><small>Semua kategori</small></article>
        <article className="stat-card"><span>Antre sekarang</span><strong>{data?.stats.queued ?? 0}</strong><small>Belum dikirim ke Buffer/Facebook</small></article>
        <article className="stat-card"><span>Sudah dikirim</span><strong>{data?.stats.ready ?? 0}</strong><small>Diterima Buffer, menunggu slot tayang</small></article>
        <article className="stat-card"><span>Terbit hari ini</span><strong>{data?.stats.publishedToday ?? 0}</strong><small>Sudah tayang di halaman</small></article>
        <article className="stat-card"><span>Total terbit</span><strong>{data?.stats.published ?? 0}</strong><small>Sepanjang riwayat</small></article>
        <article className="stat-card"><span>Masuk antrean Buffer hari ini</span><strong>{data?.stats.bufferQueuedToday ?? 0}</strong><small>Buffer menerbitkan sesuai jadwal Page</small></article>
        <article className="stat-card"><span>Feed aktif</span><strong>{data?.stats.enabledFeeds ?? 0}</strong><small>{data?.stats.totalFeeds ?? 0} feed tersimpan</small></article>
        <article className="stat-card"><span>Perlu perhatian</span><strong className={(data?.stats.failed ?? 0) > 0 ? "number-alert" : ""}>{data?.stats.failed ?? 0}</strong><small>Artikel gagal diproses</small></article>
      </section>

      <section className="panel readiness-panel">
        <div className="panel-heading"><div><p className="eyebrow">PEMERIKSAAN LAYANAN</p><h2>Apa yang sudah siap?</h2></div><span className="muted">Refresh otomatis tiap menit</span></div>
        <div className="check-grid">{Object.entries(integrationLabels).map(([key, label]) => <div className="check-item" key={key}><span className={checks[key] ? "check-dot good" : "check-dot"} />{label}<strong>{checks[key] ? "Siap" : "Belum"}</strong></div>)}</div>
        <p className="muted small-note">Panen terjadwal tiap {data?.schedule.harvestEveryHours ?? 4} jam (maks. {data?.schedule.maxArticlesPerHarvest ?? 50} berita, dan otomatis dipicu oleh <code>/api/cron</code> bila RSS kedaluwarsa). Publisher otomatis: maks. <b>{data?.schedule.maxPerDay ?? 4} post/hari</b> (pagi · siang · sore · malam), {data?.schedule.maxPerHour ?? 1} post/jam, jeda minimum {data?.schedule.minimumGapMinutes ?? 210} menit. Ini ritme editorial yang sedang diuji, bukan jaminan distribusi Meta. Review manual tidak dibatasi. Jumlah kiriman Buffer hari ini: {data?.stats.bufferQueuedToday ?? 0}.</p>
        <div className="slot-row">
          <div className="slot-head">
            <strong>{publishSchedule?.enabled ? (publishSchedule.active ? `Jendela aktif: slot ${publishSchedule.activeSlot} WITA` : "Di luar jadwal tayang") : "Jadwal slot dimatikan"}</strong>
            <span>{publishSchedule?.enabled && publishSchedule.nextSlot ? `Slot berikutnya ${publishSchedule.nextSlot} WITA · ${publishSchedule.minutesUntilNextSlot} menit lagi` : "Publisher otomatis boleh jalan kapan saja"}</span>
          </div>
          {(publishSchedule?.slots.length ?? 0) > 0 && <div className="slot-chips">{publishSchedule?.slots.map((slot) => <span key={slot} className={slot === publishSchedule.activeSlot ? "slot-chip active" : "slot-chip"}>{slot}</span>)}</div>}
          <small className="muted small-note">Jam dalam WITA (UTC+8, tanpa DST). Publisher otomatis hanya mengirim dalam {publishSchedule?.graceMinutes ?? 14} menit setelah jam slot, meski cron berjalan setiap 15 menit. Tombol “Terbitkan” manual dan review manual melewati jadwal ini.</small>
        </div>
        {feedPages.size > 0 && [...feedPages].some((key) => key === "news" || key === "entertainment") && (
          <p className="muted small-note">Halaman tujuan aktif: {[...feedPages].map((key) => key === "news" ? "Berita" : "Hiburan").join(" · ")}</p>
        )}
        {feedPages.has("entertainment") && (
          <p className="muted small-note">Feed Hiburan hanya terbit sebagai carousel tepat 4 gambar yang layak. Jika belum ada 4, publisher menunggu; halaman Berita memakai alur post single terpisah.</p>
        )}
        {data?.pillars?.list && (
          <div className="pillar-block">
            <div className="pillar-head">
              <strong>Pilar konten</strong>
              <span className="muted small-note">
                Pilar membantu variasi roundup, tetapi bukan kuota atau syarat wajib; roundup satu pilar tetap boleh terbit.
              </span>
            </div>
            <div className="pillar-strip">
              {data.pillars.list.map((pillar) => (
                <span className="pillar-chip" key={pillar.id} title={pillar.summary}>
                  <b>{pillar.label}</b>
                  <i>{pillar.share}</i>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
      </>)}

      {activeTab === "contentManager" && (
      <section className="panel content-manager-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">EDITORIAL AGENT · POPBEEZ</p>
            <h2>Smart Content Manager</h2>
            <p className="muted small-note">AI merencanakan kurasi, urutan Slide 1–4, SEO, dan arahan penulis; RSS, gambar, serta deduplikasi teknis tetap ditangani kode deterministik. Jika AI gagal, kurator fallback tetap menjaga jadwal publikasi.</p>
          </div>
          <span className={`system-pill ${contentManagerDraft?.enabled ? "ready" : "pending"}`}>{contentManagerDraft?.enabled ? "AGENT AKTIF" : "AGENT NONAKTIF"}</span>
        </div>

        <div className="queue-counts manager-metrics">
          <span>{data?.contentManager?.eligibleQueueCount ?? 0} kandidat bergambar layak</span>
          <span>{data?.contentManager?.performance.totalClicks7d ?? 0} klik shortlink · 7 hari</span>
          <span>{data?.contentManager?.performance.publishedPosts7d ?? 0} post terbit · 7 hari</span>
          <span>rata-rata orisinalitas {data?.contentManager?.performance.averageOriginality7d ?? 0}/100</span>
        </div>

        <div className="manager-columns">
          <form className="manager-config" onSubmit={(event) => void saveContentManagerSettings(event)}>
            <div className="form-title"><strong>Strategi &amp; arahan redaksi</strong><span>Disimpan di memori bersama Neon dan digunakan konsisten oleh semua provider AI.</span></div>
            {contentManagerDraft ? <>
              <label className="manager-toggle"><input type="checkbox" checked={contentManagerDraft.enabled} onChange={(event) => setContentManagerDraft((current) => current ? { ...current, enabled: event.target.checked } : current)} /><span><b>Aktifkan AI Content Manager</b><small>Matikan untuk memakai kurator deterministik saja.</small></span></label>
              <label className="manager-toggle"><input type="checkbox" checked={contentManagerDraft.autoArchiveDuplicates} onChange={(event) => setContentManagerDraft((current) => current ? { ...current, autoArchiveDuplicates: event.target.checked } : current)} /><span><b>Arsipkan duplikat lintas sumber otomatis</b><small>Artikel prioritas manual tidak akan diarsipkan otomatis.</small></span></label>
              <label className="full-field">Arahan khusus Pemimpin Redaksi
                <textarea rows={4} maxLength={600} value={contentManagerDraft.customDirective} onChange={(event) => setContentManagerDraft((current) => current ? { ...current, customDirective: event.target.value } : current)} placeholder="Contoh: utamakan kabar comeback dan jadwal rilis; hindari spekulasi kencan yang belum dikonfirmasi." />
              </label>
              <fieldset className="manager-fieldset"><legend>Pilar fokus (opsional)</legend><div className="manager-pillars">{Object.values(PILLARS).map((pillar) => <label key={pillar.id}><input type="checkbox" checked={contentManagerDraft.focusPillars.includes(pillar.id)} onChange={() => setContentManagerDraft((current) => current ? { ...current, focusPillars: current.focusPillars.includes(pillar.id) ? current.focusPillars.filter((id) => id !== pillar.id) : [...current.focusPillars, pillar.id] } : current)} /><span>{pillar.label}</span></label>)}</div></fieldset>
              <label className="full-field">Topik atau kata kunci yang dihindari (pisahkan koma)
                <input value={contentManagerDraft.avoidKeywords.join(", ")} maxLength={480} onChange={(event) => setContentManagerDraft((current) => current ? { ...current, avoidKeywords: event.target.value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12) } : current)} placeholder="rumor tanpa konfirmasi, spoiler" />
              </label>
              <label className="full-field">Nada redaksi pilihan
                <select value={contentManagerDraft.preferredVoice} onChange={(event) => setContentManagerDraft((current) => current ? { ...current, preferredVoice: event.target.value as ContentManagerSettings["preferredVoice"] } : current)}>
                  <option value="auto">Otomatis sesuai slot WITA</option>
                  <option value="kritis">Kritis</option>
                  <option value="santai">Santai</option>
                  <option value="industri">Industri</option>
                  <option value="penonton">Penonton</option>
                </select>
              </label>
              <button type="submit" className="primary-button" disabled={busy}>{busy ? "Menyimpan…" : "Simpan strategi di Neon"}</button>
            </> : <p className="muted">Pengaturan Content Manager sedang dimuat.</p>}
          </form>

          <div className="manager-analytics">
            <div className="form-title"><strong>Performa konten 7 hari</strong><span>Short link menjadi sinyal minat Beezers untuk kurasi berikutnya.</span></div>
            {(data?.contentManager?.performance.topPillars.length ?? 0) > 0 ? <div className="manager-pillar-stats">{data?.contentManager?.performance.topPillars.map((pillar) => <div className="manager-pillar-row" key={pillar.pillar}><span>{PILLARS[pillar.pillar as keyof typeof PILLARS]?.label ?? pillar.pillar}</span><b>{pillar.clicks} klik</b><small>{pillar.posts} post</small></div>)}</div> : <p className="empty-state compact-empty">Belum ada sinyal klik atau post yang cukup untuk membandingkan pilar.</p>}
            {(data?.contentManager?.performance.topPerformers.length ?? 0) > 0 && <div className="manager-performers"><strong>Post dengan klik terbanyak</strong>{data?.contentManager?.performance.topPerformers.slice(0, 3).map((post) => <div key={`${post.title}-${post.clicks}`}><b>{post.clicks} klik</b><span>{post.title}</span></div>)}</div>}
            <div className="manager-simulate">
              <strong>Simulasi rapat redaksi langsung</strong>
              <p className="muted small-note">Menjalankan kurator dengan strategi tersimpan pada antrean Hiburan saat ini, menyimpan jejak keputusan, tetapi tidak mengubah status artikel dan tidak memublikasikan. Simpan perubahan strategi terlebih dahulu.</p>
              <button type="button" className="secondary-button" onClick={() => void simulateContentManager()} disabled={busy || (data?.contentManager?.eligibleQueueCount ?? 0) < 4}>{busy ? "Memproses…" : "Simulasikan kurasi sekarang"}</button>
              {(data?.contentManager?.eligibleQueueCount ?? 0) < 4 && <small className="muted">Perlu minimal 4 kandidat Hiburan bergambar layak untuk simulasi.</small>}
            </div>
          </div>
        </div>

        {contentManagerSimulation?.ok && contentManagerSimulation.decision && <section className="manager-preview">
          <div className="panel-heading"><div><p className="eyebrow">HASIL SIMULASI · {contentManagerSimulation.provider ?? "Fallback deterministik"}{contentManagerSimulation.model ? ` · ${contentManagerSimulation.model}` : ""}</p><h3>{contentManagerSimulation.decision.roundupTheme}</h3></div><span className="format-tag carousel">{contentManagerSimulation.elapsedMs ?? 0} ms</span></div>
          <div className="manager-slide-list">{contentManagerSimulation.selectedArticles?.map((article) => <article key={article.id}><b>Slide {article.slide} · {article.pillar}</b><strong>{article.title}</strong><small>{article.sourceName} · {article.category}</small></article>)}</div>
          <div className="manager-decision-copy"><p><b>Nada:</b> {contentManagerSimulation.decision.recommendedVoice} · <b>SEO:</b> {contentManagerSimulation.decision.seoKeywords.join(" · ")}</p><p><b>Writer brief:</b> {contentManagerSimulation.decision.writerBrief}</p><p><b>Alasan editorial:</b> {contentManagerSimulation.decision.editorialReasoning}</p></div>
          {(contentManagerSimulation.duplicateArticles?.length ?? 0) > 0 && <p className="muted small-note"><b>Kandidat duplikat terdeteksi (tidak diubah simulasi):</b> {contentManagerSimulation.duplicateArticles?.map((article) => `${article.title} — ${article.sourceName}`).join(" · ")}</p>}
        </section>}

        <div className="manager-history">
          <div className="form-title"><strong>Memori keputusan agent</strong><span>Terbaru dulu; keputusan disimpan maksimal 14 hari.</span></div>
          {(data?.contentManager?.recentDecisions.length ?? 0) > 0 ? <div className="manager-decision-list">{data?.contentManager?.recentDecisions.map((decision) => <article key={decision.id}>
            <div className="manager-decision-header"><b>{decision.trigger === "simulation" ? "Simulasi" : "Publikasi"} · {decision.mode === "ai" ? "AI" : "Fallback deterministik"}</b><time>{formatDate(decision.createdAt)}</time></div>
            <strong>{decision.roundupTheme || "Edisi PopBeez"}</strong>
            <p>{decision.editorialReasoning}</p>
            <small>{decision.provider ?? "tanpa provider"}{decision.model ? ` · ${decision.model}` : ""} · {decision.selectedIds.length} terpilih · {decision.duplicateIds.length} duplikat · {decision.recommendedVoice ?? "nada otomatis"}</small>
          </article>)}</div> : <p className="empty-state compact-empty">Belum ada keputusan tersimpan. Jalankan simulasi untuk menguji agent, atau tunggu edisi berikutnya.</p>}
        </div>
        <p className="muted small-note">Jika tabel belum tersedia, sistem mencoba membuatnya otomatis. Migrasi terkontrol: <code>drizzle/0017_content_manager.sql</code>. Kunci AI tidak disimpan di sini; router menggunakan Groq → Gemini → Gemini cadangan → OpenRouter Free.</p>
      </section>
      )}

      {activeTab === "diagnostics" && (
      <section className="panel readiness-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PEMANTAU OTOMASI &amp; ERROR</p>
            <h2>Diagnostik Sistem, Cron &amp; RSS</h2>
            <p className="muted small-note">
              Halaman ini membaca langsung status database Neon, detak pemicu cron otomatis, error pengambilan RSS, kegagalan AI/orisinalitas, serta error Graph API tanpa perlu membuka SQL editor.
            </p>
          </div>
          <span className={activeDiagnostics?.health.level === "healthy" ? "system-pill ready" : "system-pill pending"}>
            {activeDiagnostics?.health.level === "critical" ? "PERLU TINDAKAN" : activeDiagnostics?.health.level === "warning" ? "ADA PERINGATAN" : "SEHAT"}
          </span>
        </div>

        <div className="diagnostic-actions" style={{ flexWrap: "wrap", marginBottom: 14 }}>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void runSystemCheck()}>
            {busy ? "Memeriksa…" : "Muat ulang diagnostik"}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void runSystemCheck({ runHarvest: true, probeAi: true })}>
            {busy ? "Menjalankan…" : "Panen RSS + Uji AI sekarang"}
          </button>
          <button type="button" className="secondary-button" disabled={busy || !canPublish} onClick={() => void publishOne()}>
            Terbitkan 1 post manual
          </button>
          {(activeDiagnostics?.failedArticles.length ?? 0) > 0 && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void requeueAllFailedArticles()}>
              Pulihkan artikel gagal ({activeDiagnostics?.failedArticles.length})
            </button>
          )}
          <button type="button" className="quiet-button" disabled={!activeDiagnostics} onClick={() => void copyDiagnosticsReport()}>
            {diagCopied ? "Laporan tersalin ✓" : "Salin laporan JSON"}
          </button>
        </div>

        <section className="stat-grid" aria-label="Detak otomasi">
          <article className="stat-card">
            <span>Detak /api/cron terakhir</span>
            <strong>{activeDiagnostics?.health.minutesSinceLastCron != null ? `${activeDiagnostics.health.minutesSinceLastCron} mnt lalu` : "Belum tercatat"}</strong>
            <small>{formatDate(activeDiagnostics?.heartbeats.lastCronAt ?? null)} · {activeDiagnostics?.heartbeats.lastCronOutcome ?? "—"}</small>
          </article>
          <article className="stat-card">
            <span>Panen RSS terakhir</span>
            <strong>{activeDiagnostics?.health.minutesSinceLastHarvest != null ? `${activeDiagnostics.health.minutesSinceLastHarvest} mnt lalu` : "Belum pernah"}</strong>
            <small>{formatDate(activeDiagnostics?.heartbeats.lastFeedFetchedAt ?? activeDiagnostics?.heartbeats.lastHarvestAt ?? null)}</small>
          </article>
          <article className="stat-card">
            <span>Post terakhir terbit</span>
            <strong className={(activeDiagnostics?.health.hoursSinceLastPublish ?? 0) >= 14 ? "number-alert" : ""}>
              {activeDiagnostics?.health.hoursSinceLastPublish != null ? `${activeDiagnostics.health.hoursSinceLastPublish} jam lalu` : "Belum ada"}
            </strong>
            <small>{formatDate(activeDiagnostics?.heartbeats.lastPublishedAt ?? null)}</small>
          </article>
          <article className="stat-card">
            <span>Kandidat Carousel Hiburan</span>
            <strong className={(activeDiagnostics?.queue.imageEligibleEntertainment ?? 0) < 4 ? "number-alert" : ""}>
              {activeDiagnostics?.queue.imageEligibleEntertainment ?? 0}/4 layak
            </strong>
            <small>{activeDiagnostics?.queue.queuedEntertainment ?? 0} di antrean · {activeDiagnostics?.queue.expiredLast24h ?? 0} kedaluwarsa (24j)</small>
          </article>
        </section>

        <div className="setup-grid" style={{ marginTop: 14 }}>
          {(activeDiagnostics?.health.issues ?? []).length === 0 ? (
            <article className="setup-card">
              <span className="check-dot good" />
              <div>
                <strong>Tidak ada error atau hambatan aktif</strong>
                <p>Detak cron, pengambilan feed RSS, dan antrean berjalan normal.</p>
              </div>
              <b>Normal</b>
            </article>
          ) : (
            (activeDiagnostics?.health.issues ?? []).map((issue, idx) => (
              <article className="setup-card" key={`${issue.code}-${idx}`}>
                <span className="check-dot" />
                <div>
                  <strong>{issue.title}</strong>
                  <p>{issue.detail}</p>
                </div>
                <b className="number-alert">{issue.severity === "critical" ? "Kritis" : "Peringatan"}</b>
              </article>
            ))
          )}
        </div>

        {activeDiagnostics && (
          <div className="diagnostic-result" style={{ marginTop: 14 }}>
            <strong>Checklist Jadwal Eksternal (cron-job.org)</strong>
            <span>
              1) Publisher otomatis (tiap 15 menit, metode <b>GET</b> atau <b>POST</b>, batas waktu <b>30 detik</b>): <code>{activeDiagnostics.cronSetup.cronEndpoint}</code>
            </span>
            <span>
              2) Panen RSS (tiap 2–4 jam, metode <b>GET</b> atau <b>POST</b>, batas waktu <b>30 detik</b>): <code>{activeDiagnostics.cronSetup.harvestEndpoint}</code>
            </span>
            <small>
              Header wajib pada kedua job: <code>Authorization: Bearer &lt;CRON_SECRET&gt;</code>.{" "}
              {activeDiagnostics.cronSetup.shortlinkOnlyHost
                ? `Jangan gunakan domain shortlink (${activeDiagnostics.cronSetup.shortlinkOnlyHost}) untuk cron karena semua jalur selain /s/* dikembalikan 404.`
                : ""}
            </small>
          </div>
        )}

        {(activeDiagnostics?.failingFeeds.length ?? 0) > 0 && (
          <div style={{ marginTop: 18 }}>
            <p className="eyebrow">ERROR FEED RSS ({activeDiagnostics?.failingFeeds.length})</p>
            <div className="feed-list">
              {activeDiagnostics?.failingFeeds.map((feed) => (
                <article className="feed-row" key={feed.id}>
                  <div className="feed-row-main">
                    <strong>{feed.name} <span className={`tag ${feed.pageKey}`}>{pageLabel(feed.pageKey)}</span></strong>
                    <small className="muted">Diperiksa: {formatDate(feed.lastFetchedAt)} · {feed.feedUrl}</small>
                    <p className="article-error" style={{ margin: "4px 0 0" }}>{feed.lastError}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {(activeDiagnostics?.failedArticles.length ?? 0) > 0 && (
          <div style={{ marginTop: 18 }}>
            <p className="eyebrow">ARTIKEL GAGAL DIPROSES ({activeDiagnostics?.failedArticles.length})</p>
            <div className="feed-list">
              {activeDiagnostics?.failedArticles.map((item) => (
                <article className="feed-row" key={item.id}>
                  <div className="feed-row-main">
                    <strong>{item.title}</strong>
                    <small className="muted">{item.sourceName} · Percobaan {item.attempts}x · {formatDate(item.updatedAt)}</small>
                    <p className="article-error" style={{ margin: "4px 0 0" }}>{item.errorMessage}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {(activeDiagnostics?.subsystemErrors.length ?? 0) > 0 && (
          <div style={{ marginTop: 18 }}>
            <p className="eyebrow">CATATAN SUBSISTEM (INSTAGRAM / KOMENTAR / KUIS / REELS)</p>
            <div className="feed-list">
              {activeDiagnostics?.subsystemErrors.map((err, index) => (
                <article className="feed-row" key={`${err.subsystem}-${index}`}>
                  <div className="feed-row-main">
                    <strong>[{err.subsystem.toUpperCase()}] {err.title}</strong>
                    <small className="muted">{formatDate(err.occurredAt)}</small>
                    <p className="article-error" style={{ margin: "4px 0 0" }}>{err.errorMessage}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 18 }}>
          <p className="eyebrow">RIWAYAT EKSEKUSI OTOMATIS TERBARU ({activeDiagnostics?.recentEvents.length ?? 0})</p>
          {(activeDiagnostics?.recentEvents.length ?? 0) === 0 ? (
            <p className="muted small-note">Belum ada riwayat terekam. Begitu <code>/api/cron</code> atau <code>/api/harvest</code> terpanggil, setiap eksekusi akan muncul di sini.</p>
          ) : (
            <div className="feed-list">
              {activeDiagnostics?.recentEvents.map((event) => (
                <article className="feed-row" key={event.id}>
                  <div className="feed-row-main">
                    <strong>
                      <code>{event.source}</code> · <span className={event.outcome === "error" ? "number-alert" : ""}>{event.outcome}</span>{" "}
                      <small className="muted">({event.trigger === "manual" ? "manual" : "terjadwal"} · {formatDate(event.createdAt)})</small>
                    </strong>
                    <small>{event.summary}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {activeTab === "setup" && (
      <section className="panel readiness-panel setup-panel">
        <div className="panel-heading"><div><p className="eyebrow">PANDUAN SETUP API</p><h2>Hubungkan AI dan Buffer</h2></div><a className="feed-url" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Buka Vercel ↗</a></div>
        <div className="setup-grid">
          <article className="setup-card"><span className={checks.groq ? "check-dot good" : "check-dot"} /><div><strong>Groq AI (utama)</strong><p>Model aktif: <code>{data?.aiModels.groq || "llama-3.3-70b-versatile"}</code>. Jika model tak tersedia atau key tak berizin, aplikasi beralih ke Gemini.</p></div><b>{checks.groq ? "Key tersedia" : "Opsional"}</b></article>
          <article className="setup-card"><span className={checks.gemini ? "check-dot good" : "check-dot"} /><div><strong>Gemini AI (cadangan)</strong><p>Model aktif: <code>{data?.aiModels.gemini || "otomatis"}</code>. Key cadangan dicoba jika Gemini utama gagal.</p></div><b>{checks.gemini ? "Key tersedia" : "Opsional"}</b></article>
          <article className="setup-card"><span className={checks.openRouter ? "check-dot good" : "check-dot"} /><div><strong>OpenRouter Free (cadangan terakhir)</strong><p>Atur <code>OPENROUTER_API_KEY</code> opsional di Vercel. Model disaring agar hanya memakai <code>:free</code> / <code>openrouter/free</code>; pilihan saat ini: <code>{data?.aiModels.openRouter || "otomatis"}</code>.</p></div><b>{checks.openRouter ? "Key tersedia" : "Opsional"}</b></article>
          <article className="setup-card"><span className={checks.bufferApi ? "check-dot good" : "check-dot"} /><div><strong>Buffer API</strong><p>Tambahkan <code>BUFFER_API_KEY</code> dari pengaturan/developer portal Buffer ke Vercel. Aplikasi mengirim post ke antrean Buffer; Buffer yang menerbitkannya pada jadwal channel.</p><a className="feed-url" href="https://developers.buffer.com/" target="_blank" rel="noreferrer">Dokumentasi API Buffer ↗</a></div><b>{checks.bufferApi ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.bufferNews ? "check-dot good" : "check-dot"} /><div><strong>Channel Buffer — Berita</strong><p>Atur <code>BUFFER_NEWS_CHANNEL_ID</code> ke ID channel Facebook Page berita di Buffer.</p></div><b>{checks.bufferNews ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.bufferEntertainment ? "check-dot good" : "check-dot"} /><div><strong>Channel Buffer — Hiburan</strong><p>Atur <code>BUFFER_ENTERTAINMENT_CHANNEL_ID</code> ke ID channel Facebook Page hiburan di Buffer.</p></div><b>{checks.bufferEntertainment ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.facebookEntertainment ? "check-dot good" : "check-dot"} /><div><strong>Facebook Graph — PopBeez</strong><p>Isi <code>FB_ENTERTAINMENT_PAGE_ID</code> dan <code>FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN</code>. Token butuh izin <code>pages_manage_posts</code> + <code>pages_read_engagement</code>.</p></div><b>{checks.facebookEntertainment ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.instagram ? "check-dot good" : "check-dot"} /><div><strong>Instagram — @popbeez.hive</strong><p>Setiap post Facebook otomatis dicerminkan ke Instagram. Syarat: akun Instagram <strong>Business/Creator</strong> yang tertaut ke halaman Facebook, lalu isi <code>IG_USER_ID</code> dan <code>IG_ACCESS_TOKEN</code> (izin <code>instagram_basic</code> + <code>instagram_content_publish</code>). Token halaman FB bisa dipakai bila akun IG sudah tertaut. Reel butuh <code>BLOB_READ_WRITE_TOKEN</code> agar videonya punya URL publik.</p></div><b>{checks.instagram ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className="check-dot good" /><div><strong>Landing page — feed otomatis</strong><p>Landing page cukup memanggil <code>GET /api/public/posts?page=entertainment&amp;limit=12</code> (bisa dari mana saja, CORS terbuka). Setiap post yang sudah terbit di Facebook/Instagram langsung muncul di JSON itu. Tidak ada cron atau deploy ulang yang dibutuhkan; cukup satu <code>fetch</code> + <code>setInterval</code> 60 detik di landing page.</p><a className="feed-url" href="/api/public/posts?limit=3" target="_blank" rel="noreferrer">Lihat contoh feed ↗</a></div><b>Aktif</b></article>
          <article className="setup-card"><span className={checks.blobStorage ? "check-dot good" : "check-dot"} /><div><strong>Vercel Blob — gambar artikel</strong><p>Atur <code>BLOB_READ_WRITE_TOKEN</code> agar foto RSS disimpan sebagai URL publik tahan lama. Tanpa token, aplikasi tetap mencoba foto sumber langsung.</p></div><b>{checks.blobStorage ? "Tersedia" : "Belum diatur"}</b></article>
        </div>
        {(checks.groq || checks.gemini || checks.openRouter) && <div className="diagnostic-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void testAiConnection()}>{busy ? "Memeriksa…" : "Tes koneksi AI (tanpa menerbitkan)"}</button>
          <p className="muted small-note">Tes ini mengirim prompt teknis singkat ke provider aktif dan memakai sedikit kuota API. Tes tidak menyimpan hasil dan tidak mengirim apa pun ke Buffer/Facebook.</p>
        </div>}
        {aiDiagnostic && <div className={`diagnostic-result ${aiDiagnostic.ok ? "success" : "failure"}`}>
          <strong>{aiDiagnostic.ok ? `AI aktif: ${aiDiagnostic.provider} · ${aiDiagnostic.model}` : "Semua percobaan AI gagal"}</strong>
          <span>{aiDiagnostic.ok ? `${aiDiagnostic.elapsedMs ?? 0} ms. ${aiDiagnostic.detail ?? ""}` : aiDiagnostic.error}</span>
          {(aiDiagnostic.attempts ?? []).map((attempt, index) => <small key={`${attempt.provider}-${index}`}><b>{attempt.provider} · {attempt.model}</b> — {attempt.outcome}, {attempt.elapsedMs} ms{attempt.error ? ` · ${attempt.error}` : ""}</small>)}
          {aiDiagnostic.requestId && <small>ID diagnostik: <code>{aiDiagnostic.requestId}</code></small>}
        </div>}
        <p className="muted small-note">Simpan <code>BUFFER_API_KEY</code> dan kedua ID channel hanya di Vercel → Project → Settings → Environment Variables, lalu deploy ulang. Dashboard tidak meminta atau menyimpan API key. Status “Key tersedia” hanya memeriksa keberadaan nilai, bukan membuktikan key/model valid; gunakan tes di atas untuk menguji jalur AI.</p>
        {checks.bufferApi && <button type="button" className="secondary-button" disabled={busy} onClick={() => void loadBufferChannels()}>{busy ? "Memeriksa…" : "Tes Buffer & tampilkan ID channel (hanya baca)"}</button>}
        {bufferMappings && <div className="setup-grid"><article className="setup-card"><span className={bufferMappings.news.status === "ready" ? "check-dot good" : "check-dot"} /><div><strong>Mapping channel Berita</strong><p>{bufferMappingLabel(bufferMappings.news)}</p></div></article><article className="setup-card"><span className={bufferMappings.entertainment.status === "ready" ? "check-dot good" : "check-dot"} /><div><strong>Mapping channel Hiburan</strong><p>{bufferMappingLabel(bufferMappings.entertainment)}</p></div></article></div>}
        {bufferChannels.length > 0 && <div className="feed-list">{bufferChannels.map((channel) => <article className="feed-row" key={channel.id}><div className="feed-row-main"><strong>{channel.name}</strong><small className="muted">{channel.service} · {channel.type}{channel.isDisconnected ? " · terputus" : ""}</small><code>{channel.id}</code></div></article>)}</div>}
        <p className="muted small-note">Logo Nusabeez dan PopBeez disertakan otomatis dari folder <code>public/brand</code>. Untuk logo pengganti, atur <code>PAGE_LOGO_NEWS_URL</code> atau <code>PAGE_LOGO_ENTERTAINMENT_URL</code> ke URL HTTPS publik.</p>
      </section>
      )}

      {activeTab === "originality" && (
      <section className="panel originality-panel">
        <div className="panel-heading"><div><p className="eyebrow">NILAI TAMBAH</p><h2>Penjaga orisinalitas</h2><p className="muted small-note">Setiap caption wajib membawa analisis, opini redaksi, dan pertanyaan diskusi. Sebelum dikirim, caption diperiksa otomatis: bila terlalu mirip sumber atau tidak punya sudut pandang, post <b>ditahan</b> dan tidak pernah sampai ke Facebook. Ambang lulus saat ini <b>{data?.originality.threshold ?? 45}/100</b> (<code>ORIGINALITY_MIN_SCORE</code>).</p></div><span className="format-tag carousel">Anti “Limited Originality”</span></div>
        <div className="queue-counts"><span>{data?.originality.scored ?? 0} post dinilai</span><span>rata-rata {data?.originality.average ?? 0}/100</span><span>{data?.originality.safe ?? 0} aman</span><span>{data?.originality.watch ?? 0} pantau</span><span className={(data?.originality.risky ?? 0) > 0 ? "count-alert" : ""}>{data?.originality.risky ?? 0} berisiko</span><span>{data?.originality.held ?? 0} ditahan</span></div>
        <div className="setup-grid">
          <article className="setup-card"><span className="check-dot good" /><div><strong>Analisis + opini</strong><p>Paragraf opini ditulis ulang per berita dengan nada ngobrol (“Menurut PopBeez sih…”), plus alasan dan perbandingan — bukan ringkasan sumber, tanpa label section.</p></div></article>
          <article className="setup-card"><span className="check-dot good" /><div><strong>Larangan salin</strong><p>8 kata berurutan yang sama dengan sumber langsung menurunkan skor ke ambang tahan. Gagal sekali, caption ditulis ulang otomatis dengan brief lebih ketat; parafrase total, tanpa fakta baru.</p></div></article>
          <article className="setup-card"><span className="check-dot good" /><div><strong>Pertanyaan diskusi</strong><p>Setiap post diakhiri pertanyaan yang menyapa <b>Beezers</b>, jadi komentar pembaca ikut jadi nilai tambah, bukan cuma reaksi.</p></div></article>
          <article className="setup-card"><span className="check-dot good" /><div><strong>Jejak audit</strong><p>Skor, panjang salinan, dan alasan disimpan di kolom <code>originality_score</code>/<code>originality_notes</code> untuk ditinjau ulang.</p></div></article>
        </div>
        {data?.originality.schemaReady === false && <p className="muted small-note">Kolom <code>editorial_take</code>, <code>originality_score</code>, dan <code>originality_notes</code> belum ada. Jalankan <code>drizzle/0011_originality.sql</code> di Neon; penahanan caption tetap berjalan walau skor belum tersimpan.</p>}
        {(data?.originality.scored ?? 0) === 0 && <p className="muted small-note">Belum ada post yang dinilai. Skor muncul setelah artikel berikutnya diproses pipeline.</p>}
      </section>
      )}

      {activeTab === "reels" && (
      <section className="panel reels-panel">
        <div className="reel-prompt-card">
          <p className="eyebrow">BUAT VIDEO DENGAN AI LAIN</p>
          <h3>Prompt Reel dari artikel</h3>
          <p className="muted small-note">Pilih artikel hiburan yang sudah memiliki naskah narasi. Prompt disusun dari judul, kategori, sumber, dan naskah artikel agar bisa disalin ke layanan AI video pilihanmu. Fitur ini hanya menyiapkan prompt—tidak merender atau memposting video.</p>
          {reelPromptArticles.length ? <>
            <label className="reel-prompt-label">Pilih artikel
              <select value={selectedReelPromptArticle?.id ?? ""} onChange={(event) => { setReelPromptArticleId(event.target.value); setReelPromptCopied(false); }}>
                {reelPromptArticles.map((article) => <option key={article.id} value={article.id}>{article.title} · {article.status === "published" ? "sudah terbit" : "siap"}</option>)}
              </select>
            </label>
            {selectedReelPromptArticle && <>
              <textarea className="reel-prompt-textarea" aria-label="Prompt Reel yang bisa disalin" readOnly rows={18} value={buildExternalReelPrompt(selectedReelPromptArticle)} />
              <button type="button" className="secondary-button" onClick={() => void copyReelPrompt(selectedReelPromptArticle)}>Salin prompt</button>
              <span className="muted small-note" role="status">{reelPromptCopied ? "Prompt berhasil disalin—tempelkan ke AI video pilihanmu." : "Setelah video diunduh, tambahkan logo bulat PopBeez dan kredit HIVECOMP saat editing, lalu unggah manual ke Facebook Reels."}</span>
            </>}
          </> : <div className="empty-state"><strong>Belum ada artikel yang bisa dipilih.</strong><span>Prompt tersedia setelah artikel hiburan diproses dan memiliki naskah narasi.</span></div>}
        </div>
        <div className="panel-heading"><div><p className="eyebrow">REELS &amp; SUARA</p><h2>Reel otomatis dari naskah narasi</h2><p className="muted small-note">Setiap artikel hiburan kini membawa naskah narasi 25–35 detik. Reels menyuarakannya dengan <b>Edge TTS</b> (gratis, tanpa API key — kuota Gemini tetap untuk penulisan dan kuis), menyusun frame 1080×1920, lalu mengunggah ke Facebook Reels. Maksimal satu Reel tiap <b>{data?.reels.minGapHours ?? 20} jam</b>.</p></div><span className={data?.reels.enabled ? "status-tag published" : "status-tag"}>{data?.reels.enabled ? "AKTIF" : "MATI"}</span></div>
        <div className="queue-counts"><span>{data?.reels.published ?? 0} Reel terbit</span><span>suara: {data?.reels.ttsVoice}</span><span>render: {data?.reels.renderMode}</span><span>naskah: {data?.reels.last?.frameCount ?? 0} frame</span></div>
        {data?.reels.last ? <div className="quiz-preview">
          <div className="quiz-preview-meta">
            <strong>Reel terakhir · {data.reels.last.status} · {data.reels.last.durationSeconds} detik</strong>
            <span>{formatDate(data.reels.last.createdAt)} · sudut pandang {data.reels.last.voiceLabel ?? "Redaksi"}</span>
            {data.reels.last.errorMessage && <p className="article-error">{data.reels.last.errorMessage}</p>}
            <div className="article-links">
              {data.reels.last.videoUrl && <a className="article-source" href={data.reels.last.videoUrl} target="_blank" rel="noreferrer">Buka file video ↗</a>}
              {data.reels.last.facebookVideoId && <a className="article-source" href={`https://www.facebook.com/reel/${data.reels.last.facebookVideoId}`} target="_blank" rel="noreferrer">Buka Reel di Facebook ↗</a>}
            </div>
          </div>
        </div> : <div className="empty-state"><strong>Belum ada Reel.</strong><span>Reel dibuat dari artikel hiburan terbaru yang punya naskah narasi.</span></div>}
        <div className="setup-grid">
          {data?.reels.voices.map((voice) => <article className="setup-card" key={voice.id}><span className="check-dot good" /><div><strong>{voice.label}</strong><p>{voice.summary}</p></div></article>)}
        </div>
        {data?.reels.schemaReady === false && <p className="muted small-note">Tabel <code>reels</code> dan kolom narasi belum ada. Jalankan <code>drizzle/0012_reels_voices.sql</code> di Neon.</p>}
        {!data?.reels.enabled && <p className="muted small-note">Set <code>REELS_ENABLED=1</code> di Vercel untuk mengizinkan pembuatan otomatis. Tombol di bawah tetap bisa dipakai untuk mencoba satu Reel sekarang.</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void createReel()}>{busy ? "Menyiapkan…" : "Buat & posting Reel sekarang"}</button>
        <p className="muted small-note">Butuh encoder: <code>FFMPEG_PATH</code> di server ini, atau <code>REELS_RENDER_URL</code> + <code>REELS_WORKER_TOKEN</code> ke worker VPS (<code>scripts/reels-render-worker.mjs</code>). Tanpa keduanya, Reel ditandai gagal dan pipeline teks tidak terpengaruh.</p>
      </section>
      )}

      {activeTab === "quiz" && (
      <section className="panel quiz-panel">
        <div className="panel-heading"><div><p className="eyebrow">KUIS INTERAKSI</p><h2>Tebak Drama</h2><p className="muted small-note">Grid 2×3: lima poster acak dari review manual PopBeez, sel pojok kanan bawah berisi logo dan tulisan “Tebak Drama”. Tayang otomatis {data?.quiz.schedule} bila sudah {data?.quiz.intervalDays ?? 14} hari sejak edisi terakhir. Satu poster maksimal dipakai {data?.quiz.maxUses ?? 3}× kuis.</p></div><span className="format-tag carousel">PopBeez · 5 poster</span></div>
        {data?.quiz.lastImageUrl ? <div className="quiz-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.quiz.lastImageUrl} alt="Edisi kuis terakhir" loading="lazy" />
          <div className="quiz-preview-meta">
            <strong>Edisi terakhir · {data.quiz.tiles} poster</strong>
            <span>{formatDate(data.quiz.lastPostedAt)}</span>
            {facebookPostUrl(data.quiz.lastPostId) && <a className="article-source" href={facebookPostUrl(data.quiz.lastPostId)!} target="_blank" rel="noreferrer">Buka post kuis ↗</a>}
            {data.quiz.lastError && <p className="article-error">{data.quiz.lastError}</p>}
          </div>
        </div> : <div className="empty-state"><strong>Belum ada kuis.</strong><span>Butuh minimal lima poster dari review manual; satu review manual sudah berisi lima poster.</span></div>}
        {!data?.quiz.schemaReady && <p className="muted small-note">Tabel <code>quiz_editions</code> belum ada. Jalankan <code>drizzle/0010_quiz_editions.sql</code> di Neon untuk mengaktifkan kuis.</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void createQuizEdition()}>{busy ? "Menyiapkan…" : "Buat & posting kuis sekarang"}</button>
        <p className="muted small-note">Tombol ini melewati jadwal dan langsung menerbitkan ke halaman Facebook PopBeez. Kuis tidak punya kunci jawaban; caption hanya mengajak menebak nomor poster. Poster dipilih acak dan setiap poster berhenti dipakai setelah {data?.quiz.maxUses ?? 3}× kuis.</p>
      </section>
      )}

      {activeTab === "manual" && (
      <section className="panel manual-review-panel">
        <div className="panel-heading"><div><p className="eyebrow">KONTEN MANUAL</p><h2>Buat review mingguan</h2><p className="muted small-note">Isi lima pilihan film, drama, atau musik. Rating tertinggi otomatis menjadi nomor 1. Hasilnya satu carousel terpadu: cover lalu lima kartu rekomendasi.</p></div><span className="format-tag carousel">PopBeez · 6 slide</span></div>
        <form className="manual-review-form" onSubmit={submitManualReview}>
          <div className="form-grid review-heading-grid">
            <label className="full-field">Judul posting<input value={reviewHeadline} onChange={(event) => setReviewHeadline(event.target.value)} required minLength={5} maxLength={100} placeholder="Contoh: 5 Drama Rating Tertinggi Minggu Ini" /></label>
            <label>Jenis rekomendasi<select value={reviewMediaType} onChange={(event) => setReviewMediaType(event.target.value as ReviewMediaType)}><option value="FILM">Film</option><option value="DRAMA">Drama</option><option value="MUSIK">Musik</option></select></label>
          </div>
          <div className="manual-review-items">
            {reviewItems.map((item, index) => <fieldset className="manual-review-item" key={index}>
              <legend>Judul kandidat {index + 1} <span>(urutan akhir ditentukan rating)</span></legend>
              <div className="form-grid">
                <label className="full-field">Judul film / drama / musik<input value={item.title} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, title: event.target.value } : entry))} required maxLength={120} placeholder="Nama judul" /></label>
                <label>Rating (0–10)<input type="number" value={item.rating} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, rating: event.target.value } : entry))} required min="0" max="10" step="0.1" placeholder="8.7" /></label>
                <label>Genre<input value={item.genre} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, genre: event.target.value } : entry))} required maxLength={100} placeholder="Romansa, komedi" /></label>
                <label className="full-field">Link gambar (HTTPS)<input type="url" value={item.imageUrl} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, imageUrl: event.target.value } : entry))} required placeholder="https://.../poster.jpg" /></label>
                <label className="full-field">Kenapa wajib nonton? (opsional)<input value={item.reason} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, reason: event.target.value } : entry))} maxLength={240} placeholder="Satu kalimat tentang daya tariknya" /></label>
                <label className="full-field">Cocok untuk siapa? (opsional)<input value={item.suitableFor} onChange={(event) => setReviewItems((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, suitableFor: event.target.value } : entry))} maxLength={160} placeholder="Penonton yang suka tontonan ringan" /></label>
              </div>
            </fieldset>)}
          </div>
          <button type="submit" className="primary-button" disabled={busy}>{busy ? "Menyusun carousel…" : "Terbitkan review"}</button>
          <p className="muted small-note">Pastikan kamu memiliki izin menggunakan tautan gambar. Caption review tidak memuat tautan; tautan follow ditaruh di komentar pertama. Rating dan urutan berasal dari data yang kamu isi. Jika review perlu diperbaiki setelah terbit, hapus dulu post lama di Facebook/Buffer, lalu terbitkan ulang sekali. Jangan menerbitkan dua kali tanpa menghapus yang lama supaya tidak ada duplikat.</p>
        </form>
      </section>
      )}

      {activeTab === "feeds" && (
        <section className="panel feeds-panel">
          <div className="panel-heading"><div><p className="eyebrow">SUMBER BERITA</p><h2>Feed RSS</h2></div><button className="secondary-button" type="button" disabled={busy} onClick={() => void importPresets()}>Tambahkan preset hiburan</button></div>
          <form className="feed-form" onSubmit={addFeed}>
            <div className="form-title"><strong>Tambah sumber</strong><span>Disimpan langsung di database, bukan environment variable.</span></div>
            <div className="form-grid">
              <label>Nama sumber<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={100} placeholder="Contoh: ANTARA Bali" /></label>
              <label>Kategori<input value={category} onChange={(event) => setCategory(event.target.value.toUpperCase())} required maxLength={32} placeholder="BALI / DRAKOR" /></label>
              <label>Halaman tujuan<select value={pageKey} onChange={(event) => setPageKey(event.target.value as Feed["pageKey"])}><option value="news">Berita</option><option value="entertainment">Hiburan</option></select></label>
              <label>Bahasa feed<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="id">Indonesia</option><option value="en">Inggris</option><option value="zh">Mandarin</option><option value="ja">Jepang</option><option value="ko">Korea</option></select></label>
              <label className="full-field">URL RSS<input type="url" value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} required placeholder="https://situs-berita.example/rss.xml" /></label>
              <label className="full-field">Kata kunci filter (opsional, pisahkan dengan koma)<input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="donghua, bilibili, tencent" /></label>
            </div>
            <button type="submit" className="secondary-button" disabled={busy}>{busy ? "Menyimpan…" : "+ Tambahkan feed"}</button>
          </form>
          <p className="muted small-note">Preset hiburan mencakup C-Drama, donghua, K-pop/idol, Soompi All News, Seoulbeats, dan MyDramaList News. Feed Google News dan HanCinema tetap nonaktif untuk ditinjau sebelum digunakan.</p>

          <div className="feed-list">
            {data?.feeds.length ? data.feeds.map((feed) => (
              <article className={`feed-row ${feed.active ? "" : "feed-disabled"}`} key={feed.id}>
                <div className="feed-row-main">
                  <div className="feed-row-title"><strong>{feed.name}</strong><span className={`tag ${feed.pageKey}`}>{pageLabel(feed.pageKey)} · {feed.category}</span></div>
                  <a className="feed-url" href={feed.feedUrl} target="_blank" rel="noreferrer">{feed.feedUrl}</a>
                  {feed.keywords.length > 0 && <small className="muted">Filter: {feed.keywords.join(", ")}</small>}
                  <small className="muted">Terakhir dicek: {formatDate(feed.lastFetchedAt)}{feed.lastError ? ` · Error: ${feed.lastError}` : ""}</small>
                </div>
                <div className="feed-actions"><button className="quiet-button" disabled={busy} onClick={() => void toggleFeed(feed)}>{feed.active ? "Nonaktifkan" : "Aktifkan"}</button><button className="danger-button" disabled={busy} onClick={() => void deleteFeed(feed)}>Hapus</button></div>
              </article>
            )) : <div className="empty-state"><strong>Belum ada feed.</strong><span>Tambahkan feed RSS di atas. Untuk berita hiburan, pilih halaman “Hiburan”.</span></div>}
          </div>
        </section>
      )}

      {activeTab === "queue" && (
        <section className="panel articles-panel">
          <div className="panel-heading"><div><p className="eyebrow">BELUM TERBIT</p><h2>Antrean yang belum dikirim</h2><p className="muted small-note">Bagian ini hanya berisi artikel yang masih menunggu dikirim. Artikel yang sedang dikirim, sudah dikirim, atau gagal dipindahkan ke panel <b>Sudah terbit</b> di bawah. Berita prioritas dipilih lebih dulu pada siklus publisher berikutnya; berita berumur lebih dari 7 jam dikeluarkan.</p></div><div className="queue-counts"><span>{sections.queue.length} antre</span></div></div>

          {sections.queue.length > 0 && <div className="article-group">
            <div className="group-heading"><strong>Antrean lokal</strong><span>Dikirim satu per siklus publisher, dimulai dari nomor #{sections.queue[0]?.queuePosition ?? 1}.</span></div>
            <div className="article-list">{sections.queue.map((article) => renderArticleCard(article))}</div>
          </div>}

          {sections.queue.length === 0 && <div className="empty-state"><strong>Belum ada artikel menunggu.</strong><span>Tambahkan feed lalu jalankan panen untuk mengisi antrean. Jadwal publisher hanya mengambil dari antrean ini.</span></div>}

          <button type="button" onClick={() => void harvestNow()} disabled={busy} className="secondary-button run-button">{busy ? "Memproses…" : "Panen RSS sekarang (tidak menerbitkan)"}</button>
          {canPublish && <button type="button" onClick={() => void publishOne()} disabled={busy} className="primary-button run-button">{busy ? "Memproses…" : "Terbitkan"}</button>}
          {!canPublish && <p className="muted small-note">Tombol pengiriman aktif setelah feed, minimal satu penyedia AI, URL aplikasi, pengaman cron, Buffer API key, dan ID channel Buffer untuk setiap halaman tujuan siap.</p>}
        </section>
      )}

      {activeTab === "published" && (
      <section className="panel published-panel">
        <div className="panel-heading"><div><p className="eyebrow">SUDAH TERBIT</p><h2>Sudah terbit & terkirim</h2><p className="muted small-note">Semua artikel yang sudah keluar dari antrean, terbaru di atas (maksimal 20): <b>Terbit</b> sudah tayang di Facebook, <b>Antrean Buffer</b> sudah diterima Buffer dan menunggu slot jadwal, <b>Gagal</b> perlu dicoba ulang.</p></div><div className="queue-counts"><span>{liveCount} terbit</span><span>{waitingSlotCount} menunggu slot</span><span className={failedCount > 0 ? "count-alert" : ""}>{failedCount} gagal</span><span>{data?.stats.publishedToday ?? 0} terbit hari ini</span></div></div>
        {sections.done.length > 0 ? <div className="article-list">{sections.done.map((article) => renderArticleCard(article))}</div> : <div className="empty-state"><strong>Belum ada post terkirim.</strong><span>Setelah publisher memproses artikel, hasilnya muncul di sini.</span></div>}
      </section>
      )}

      <footer className="dashboard-footer"><span>News FB Fiesta · Neon Postgres</span><span>Posting otomatis dapat menerbitkan konten sungguhan. Periksa feed dan izin gambar sebelum mengaktifkan jadwal.</span></footer>
    </main>
  );
}
