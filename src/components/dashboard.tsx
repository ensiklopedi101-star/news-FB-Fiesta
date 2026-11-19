"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { facebookPostUrl, isLivePost, splitArticleSections } from "@/lib/article-sections";

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
};

type ReviewDraftItem = { title: string; rating: string; genre: string; reason: string; suitableFor: string; imageUrl: string };
type ReviewMediaType = "FILM" | "DRAMA" | "MUSIK";

function blankReviewItem(): ReviewDraftItem {
  return { title: "", rating: "", genre: "", reason: "", suitableFor: "", imageUrl: "" };
}

type DashboardData = {
  checkedAt: string;
  readyToPublish: boolean;
  integrations: Record<string, boolean>;
  aiModels: { groq: string; gemini: string };
  schedule: { maxPerHour: number; minimumGapMinutes: number; harvestEveryHours: number; maxArticlesPerHarvest: number };
  stats: { articles: number; publishedToday: number; bufferQueuedToday: number; enabledFeeds: number; totalFeeds: number; queued: number; processing: number; ready: number; published: number; failed: number; expired: number; removed: number };
  feeds: Feed[];
  articles: Article[];
};

type BufferChannel = { id: string; name: string; service: string; type: string; isDisconnected: boolean };
type BufferChannelMapping = { status: "missing-channel-id" | "id-not-found" | "not-a-facebook-page" | "disconnected" | "ready"; channelName?: string };
type AiAttempt = { provider: string; model: string; outcome: "ok" | "failed" | "skipped"; elapsedMs: number; error?: string };
type AiDiagnostic = { ok: boolean; requestId?: string; provider?: string; model?: string; elapsedMs?: number; detail?: string; error?: string; attempts: AiAttempt[] };
type ApiResult = { ok?: boolean; error?: string; result?: string; detail?: string; title?: string; mediaFormat?: string; provider?: "buffer" | "facebook"; imageUrls?: string[]; added?: number; skipped?: number; inactive?: number; scanned?: number; enriched?: number; imageCandidates?: number; imageBlobStored?: number; limited?: boolean; channels?: BufferChannel[]; mappings?: { news: BufferChannelMapping; entertainment: BufferChannelMapping } };

const integrationLabels: Record<string, string> = {
  database: "Neon database",
  schema: "Skema database",
  feeds: "RSS aktif",
  groq: "Groq AI (utama)",
  gemini: "Gemini AI (cadangan)",
  bufferApi: "Buffer API key",
  bufferNews: "Channel Buffer berita",
  bufferEntertainment: "Channel Buffer hiburan",
  facebookEntertainment: "Facebook Graph Popbeez",
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

function articleStatusLabel(article: Article) {
  if (article.status === "ready" && article.facebookPostId?.startsWith("buffer:pending:")) return "Perlu cek Buffer";
  if (article.status === "ready" && article.facebookPostId?.startsWith("facebook:pending:")) return "Perlu cek Facebook";
  if (article.status === "ready" && article.facebookPostId?.startsWith("buffer:")) return "Antrean Buffer";
  if (article.status === "ready") return "Siap";
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

export default function Dashboard() {
  const [secret, setSecret] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
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
  const [imageDrafts, setImageDrafts] = useState<Record<string, string>>({});
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
    setData(result as DashboardData);
    setAuthenticated(true);
    return result as DashboardData;
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
    if (!window.confirm("Review ini akan diterbitkan ke halaman Popbeez. Tautan mengikuti aturan komentar pertama. Pastikan rating dan semua informasi sudah benar. Lanjutkan?")) return;
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
          ? `Review “${result.title ?? reviewHeadline}” langsung diterbitkan ke halaman Facebook Popbeez.`
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

  async function harvestNow() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/harvest", { method: "POST" });
      const cap = result.limited ? " Batas panen 50 artikel tercapai." : "";
      setMessage(`Panen selesai: ${result.scanned ?? 0} item diperiksa, ${result.added ?? 0} artikel baru masuk antrean, ${result.enriched ?? 0} diperkaya dari halaman sumber; foto terdeteksi ${result.imageCandidates ?? 0}, tersimpan ke Blob ${result.imageBlobStored ?? 0}.${cap}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Panen RSS gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function publishOne() {
    if (!window.confirm("Ini akan menerbitkan satu artikel sungguhan ke halaman tujuan. Posting langsung terbit di Facebook; jika memakai Buffer, post masuk antrean sesuai jadwal channel. Lanjutkan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/cron");
      setMessage(result.result === "published" && result.title ? `Terbit di Facebook: ${result.title}` : result.result === "queued" && result.title ? `Masuk antrean Buffer: ${result.title}` : result.title ? `Berhasil diproses: ${result.title}` : result.detail || "Siklus selesai.");
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
  const sections = splitArticleSections(data?.articles ?? []);
  const pendingCount = sections.queue.length + sections.sending.length + sections.failed.length;
  const liveCount = sections.done.filter((article) => isLivePost(article.status)).length;
  const waitingSlotCount = sections.done.length - liveCount;

  function renderArticleCard(article: Article) {
    const isManualReview = article.sourceName === "Review manual Popbeez";
    const previewSlides = isManualReview && article.postFormat === "carousel" ? [1, 2, 3, 4, 5, 6] : article.postFormat === "carousel" && article.carouselSlides?.length === 3 ? [1, 2, 3, 4] : [1];
    const slideTotal = isManualReview ? 6 : 4;
    const postUrl = facebookPostUrl(article.facebookPostId);
    return (
      <article className="article-row" key={article.id}>
        <div className="article-row-top">
          {article.queuePosition && <span className="queue-position">#{article.queuePosition}</span>}
          {article.status === "queued" && article.priorityAt && <span className="status-tag priority">PRIORITAS</span>}
          <span className={`tag ${article.pageKey}`}>{pageLabel(article.pageKey)}</span>
          <span className={`status-tag ${article.status}`}>{articleStatusLabel(article)}</span>
          <span className={`format-tag ${article.postFormat}`}>{isManualReview ? article.postFormat === "carousel" ? "Review · 6 slide" : "Review · cover saja" : article.postFormat === "carousel" ? "Carousel · 4 slide" : "Satu gambar"}</span>
          {article.status === "queued" && <button type="button" className="quiet-button priority-button" disabled={busy} onClick={() => void toggleArticlePriority(article)}>{article.priorityAt ? "Batalkan prioritas" : "Jadikan prioritas"}</button>}
          {article.status === "queued" && <button type="button" className="danger-button article-remove" disabled={busy} onClick={() => void removeArticle(article)}>Hapus dari antrean</button>}
        </div>
        <strong>{article.title}</strong>
        <div className="article-meta">{article.sourceName} · {article.category} · {article.sourcePublishedAt ? "Terbit sumber" : "Masuk antrean (perkiraan)"}: {formatDate(article.sourcePublishedAt || article.createdAt)}</div>
        {article.status === "published" && <div className="article-meta published-meta">Terbit di Facebook: {formatDate(article.publishedAt)}</div>}
        {article.status === "ready" && <div className="article-meta published-meta">Dikirim: {formatDate(article.updatedAt)}</div>}
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
        </div>
      </article>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div className="brand-mark">N</div>
        <div className="header-title"><strong>News FB Fiesta</strong><span>Panel redaksi otomatis</span></div>
        <div className="header-right"><span className={canPublish ? "system-pill ready" : "system-pill pending"}>{canPublish ? "SIAP PUBLIKASI" : "SETUP BELUM LENGKAP"}</span><button className="quiet-button" onClick={() => { setAuthenticated(false); setData(null); setSecret(""); }}>Keluar</button></div>
      </header>

      <section className="dashboard-intro">
        <div><p className="eyebrow">RINGKASAN SISTEM</p><h1>Dashboard redaksi</h1><p>Kelola sumber RSS untuk dua halaman dan lihat status artikel terbaru.</p></div>
        <div className="updated-at">Diperbarui {formatDate(data?.checkedAt ?? null)}</div>
      </section>

      {message && <div className="notice">{message}</div>}

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
        <p className="muted small-note">Panen terjadwal tiap 24 jam (maks. {data?.schedule.maxArticlesPerHarvest ?? 50} berita). Publisher otomatis: maks. {data?.schedule.maxPerHour ?? 5} pengiriman/jam, jeda minimum {data?.schedule.minimumGapMinutes ?? 12} menit. Review manual tidak dibatasi. Jumlah kiriman Buffer hari ini: {data?.stats.bufferQueuedToday ?? 0}.</p>
        {feedPages.size > 0 && [...feedPages].some((key) => key === "news" || key === "entertainment") && (
          <p className="muted small-note">Halaman tujuan aktif: {[...feedPages].map((key) => key === "news" ? "Berita" : "Hiburan").join(" · ")}</p>
        )}
      </section>

      <section className="panel readiness-panel setup-panel">
        <div className="panel-heading"><div><p className="eyebrow">PANDUAN SETUP API</p><h2>Hubungkan AI dan Buffer</h2></div><a className="feed-url" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Buka Vercel ↗</a></div>
        <div className="setup-grid">
          <article className="setup-card"><span className={checks.groq ? "check-dot good" : "check-dot"} /><div><strong>Groq AI (utama)</strong><p>Model aktif: <code>{data?.aiModels.groq || "llama-3.3-70b-versatile"}</code>. Jika model tak tersedia atau key tak berizin, aplikasi beralih ke Gemini.</p></div><b>{checks.groq ? "Key tersedia" : "Opsional"}</b></article>
          <article className="setup-card"><span className={checks.gemini ? "check-dot good" : "check-dot"} /><div><strong>Gemini AI (cadangan)</strong><p>Model aktif: <code>{data?.aiModels.gemini || "gemini-3.8-flash"}</code>. Key cadangan dicoba jika Gemini utama gagal.</p></div><b>{checks.gemini ? "Key tersedia" : "Opsional"}</b></article>
          <article className="setup-card"><span className={checks.bufferApi ? "check-dot good" : "check-dot"} /><div><strong>Buffer API</strong><p>Tambahkan <code>BUFFER_API_KEY</code> dari pengaturan/developer portal Buffer ke Vercel. Aplikasi mengirim post ke antrean Buffer; Buffer yang menerbitkannya pada jadwal channel.</p><a className="feed-url" href="https://developers.buffer.com/" target="_blank" rel="noreferrer">Dokumentasi API Buffer ↗</a></div><b>{checks.bufferApi ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.bufferNews ? "check-dot good" : "check-dot"} /><div><strong>Channel Buffer — Berita</strong><p>Atur <code>BUFFER_NEWS_CHANNEL_ID</code> ke ID channel Facebook Page berita di Buffer.</p></div><b>{checks.bufferNews ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.bufferEntertainment ? "check-dot good" : "check-dot"} /><div><strong>Channel Buffer — Hiburan</strong><p>Atur <code>BUFFER_ENTERTAINMENT_CHANNEL_ID</code> ke ID channel Facebook Page hiburan di Buffer.</p></div><b>{checks.bufferEntertainment ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.blobStorage ? "check-dot good" : "check-dot"} /><div><strong>Vercel Blob — gambar artikel</strong><p>Atur <code>BLOB_READ_WRITE_TOKEN</code> agar foto RSS disimpan sebagai URL publik tahan lama. Tanpa token, aplikasi tetap mencoba foto sumber langsung.</p></div><b>{checks.blobStorage ? "Tersedia" : "Belum diatur"}</b></article>
        </div>
        {(checks.groq || checks.gemini) && <div className="diagnostic-actions">
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
        <p className="muted small-note">Logo Nusabeez dan Popbeez disertakan otomatis dari folder <code>public/brand</code>. Untuk logo pengganti, atur <code>PAGE_LOGO_NEWS_URL</code> atau <code>PAGE_LOGO_ENTERTAINMENT_URL</code> ke URL HTTPS publik.</p>
      </section>

      <section className="panel manual-review-panel">
        <div className="panel-heading"><div><p className="eyebrow">KONTEN MANUAL</p><h2>Buat review mingguan</h2><p className="muted small-note">Isi lima pilihan film, drama, atau musik. Rating tertinggi otomatis menjadi nomor 1. Hasilnya satu carousel terpadu: cover lalu lima kartu rekomendasi.</p></div><span className="format-tag carousel">Popbeez · 6 slide</span></div>
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

      <div className="dashboard-columns">
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

        <section className="panel articles-panel">
          <div className="panel-heading"><div><p className="eyebrow">BELUM TERBIT</p><h2>Antrean yang belum dikirim</h2><p className="muted small-note">Bagian ini hanya berisi artikel yang belum dikirim ke Buffer/Facebook. Berita prioritas dipilih lebih dulu pada siklus publisher berikutnya. Berita berumur lebih dari 7 jam dikeluarkan; tanpa waktu terbit RSS, umur dihitung sejak masuk antrean.</p></div><div className="queue-counts"><span>{sections.queue.length} antre</span><span>{sections.failed.length} gagal</span></div></div>

          {sections.queue.length > 0 && <div className="article-group">
            <div className="group-heading"><strong>Antrean lokal</strong><span>Dikirim satu per siklus publisher, dimulai dari nomor #{sections.queue[0]?.queuePosition ?? 1}.</span></div>
            <div className="article-list">{sections.queue.map((article) => renderArticleCard(article))}</div>
          </div>}

          {sections.sending.length > 0 && <div className="article-group">
            <div className="group-heading"><strong>Sedang dikirim</strong><span>Siklus publisher sedang memproses artikel ini sekarang.</span></div>
            <div className="article-list">{sections.sending.map((article) => renderArticleCard(article))}</div>
          </div>}

          {sections.failed.length > 0 && <div className="article-group">
            <div className="group-heading"><strong>Gagal diproses</strong><span>Periksa pesan galat, lalu coba lagi atau keluarkan dari antrean.</span></div>
            <div className="article-list">{sections.failed.map((article) => renderArticleCard(article))}</div>
          </div>}

          {pendingCount === 0 && <div className="empty-state"><strong>Belum ada artikel menunggu.</strong><span>Tambahkan feed lalu jalankan panen untuk mengisi antrean. Jadwal publisher hanya mengambil dari antrean ini.</span></div>}

          <button type="button" onClick={() => void harvestNow()} disabled={busy} className="secondary-button run-button">{busy ? "Memproses…" : "Panen RSS sekarang (tidak menerbitkan)"}</button>
          {canPublish && <button type="button" onClick={() => void publishOne()} disabled={busy} className="primary-button run-button">{busy ? "Memproses…" : "Terbitkan"}</button>}
          {!canPublish && <p className="muted small-note">Tombol pengiriman aktif setelah feed, minimal satu penyedia AI, URL aplikasi, pengaman cron, Buffer API key, dan ID channel Buffer untuk setiap halaman tujuan siap.</p>}
        </section>
      </div>

      <section className="panel published-panel">
        <div className="panel-heading"><div><p className="eyebrow">SUDAH TERBIT</p><h2>Sudah terbit & terkirim</h2><p className="muted small-note">Post yang sudah keluar dari antrean, terbaru di atas (maksimal 20). <b>Terbit</b> berarti sudah tayang di Facebook; <b>Antrean Buffer</b> berarti Buffer sudah menerima post dan menayangkannya pada slot jadwal halaman.</p></div><div className="queue-counts"><span>{liveCount} terbit</span><span>{waitingSlotCount} menunggu slot</span><span>{data?.stats.publishedToday ?? 0} terbit hari ini</span></div></div>
        {sections.done.length > 0 ? <div className="article-list">{sections.done.map((article) => renderArticleCard(article))}</div> : <div className="empty-state"><strong>Belum ada post terkirim.</strong><span>Setelah publisher mengirim artikel, post akan muncul di sini.</span></div>}
      </section>

      <footer className="dashboard-footer"><span>News FB Fiesta · Neon Postgres</span><span>Posting otomatis dapat menerbitkan konten sungguhan. Periksa feed dan izin gambar sebelum mengaktifkan jadwal.</span></footer>
    </main>
  );
}
