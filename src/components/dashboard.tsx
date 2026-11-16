"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
  status: string;
  errorMessage: string | null;
  createdAt: string;
  publishedAt: string | null;
};

type DashboardData = {
  checkedAt: string;
  readyToPublish: boolean;
  integrations: Record<string, boolean>;
  schedule: { maxPerHour: number; minimumGapMinutes: number; harvestEveryHours: number; maxArticlesPerHarvest: number };
  stats: { articles: number; publishedToday: number; enabledFeeds: number; totalFeeds: number; queued: number; processing: number; ready: number; published: number; failed: number };
  feeds: Feed[];
  articles: Article[];
};

type ApiResult = { ok?: boolean; error?: string; result?: string; detail?: string; title?: string; added?: number; skipped?: number; inactive?: number; scanned?: number; limited?: boolean };

const integrationLabels: Record<string, string> = {
  database: "Neon database",
  schema: "Skema database",
  feeds: "RSS aktif",
  gemini: "Gemini AI",
  facebookNews: "Facebook berita",
  facebookEntertainment: "Facebook hiburan",
  appUrl: "URL publik aplikasi",
  cronSecret: "Pengaman cron",
};

function formatDate(value: string | null) {
  if (!value) return "Belum pernah";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "—" : new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function pageLabel(pageKey: Feed["pageKey"]) {
  return pageKey === "news" ? "Berita" : "Hiburan";
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

  const api = useCallback(async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${secret}`);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...init, headers, cache: "no-store" });
    const result = await response.json().catch(() => ({})) as ApiResult & Partial<DashboardData>;
    if (!response.ok) throw new Error(result.error || `Permintaan gagal (HTTP ${response.status}).`);
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

  async function harvestNow() {
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/harvest", { method: "POST" });
      const cap = result.limited ? " Batas panen 50 artikel tercapai." : "";
      setMessage(`Panen selesai: ${result.scanned ?? 0} item cocok diperiksa, ${result.added ?? 0} artikel baru masuk antrean.${cap}`);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Panen RSS gagal.");
    } finally {
      setBusy(false);
    }
  }

  async function publishOne() {
    if (!window.confirm("Ini akan menjalankan pipeline dan dapat menerbitkan satu postingan sungguhan ke Facebook. Lanjutkan?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api("/api/cron");
      setMessage(result.title ? `Berhasil diproses: ${result.title}` : result.detail || "Siklus selesai.");
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
        <article className="stat-card"><span>Terbit hari ini</span><strong>{data?.stats.publishedToday ?? 0}</strong><small>Waktu UTC</small></article>
        <article className="stat-card"><span>Feed aktif</span><strong>{data?.stats.enabledFeeds ?? 0}</strong><small>{data?.stats.totalFeeds ?? 0} feed tersimpan</small></article>
        <article className="stat-card"><span>Perlu perhatian</span><strong className={(data?.stats.failed ?? 0) > 0 ? "number-alert" : ""}>{data?.stats.failed ?? 0}</strong><small>Artikel gagal diproses</small></article>
      </section>

      <section className="panel readiness-panel">
        <div className="panel-heading"><div><p className="eyebrow">PEMERIKSAAN LAYANAN</p><h2>Apa yang sudah siap?</h2></div><span className="muted">Refresh otomatis tiap menit</span></div>
        <div className="check-grid">{Object.entries(integrationLabels).map(([key, label]) => <div className="check-item" key={key}><span className={checks[key] ? "check-dot good" : "check-dot"} />{label}<strong>{checks[key] ? "Siap" : "Belum"}</strong></div>)}</div>
        <p className="muted small-note">Panen terjadwal tiap 24 jam (maks. {data?.schedule.maxArticlesPerHarvest ?? 50} berita). Rilis: maks. {data?.schedule.maxPerHour ?? 2} berita/jam, jeda minimum {data?.schedule.minimumGapMinutes ?? 15} menit.</p>
        {feedPages.size > 0 && [...feedPages].some((key) => key === "news" || key === "entertainment") && (
          <p className="muted small-note">Halaman tujuan aktif: {[...feedPages].map((key) => key === "news" ? "Berita" : "Hiburan").join(" · ")}</p>
        )}
      </section>

      <section className="panel readiness-panel setup-panel">
        <div className="panel-heading"><div><p className="eyebrow">PANDUAN SETUP API</p><h2>Hubungkan Gemini dan Facebook</h2></div><a className="feed-url" href="https://vercel.com/dashboard" target="_blank" rel="noreferrer">Buka Vercel ↗</a></div>
        <div className="setup-grid">
          <article className="setup-card"><span className={checks.gemini ? "check-dot good" : "check-dot"} /><div><strong>Gemini AI</strong><p>Buat API key di <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>, lalu simpan sebagai <code>GEMINI_API_KEY</code> di Vercel.</p></div><b>{checks.gemini ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.facebookNews ? "check-dot good" : "check-dot"} /><div><strong>Facebook — Berita</strong><p>Atur <code>FB_NEWS_PAGE_ID</code> dan <code>FB_NEWS_PAGE_ACCESS_TOKEN</code> untuk Page berita dari <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers</a>.</p></div><b>{checks.facebookNews ? "Tersedia" : "Belum diatur"}</b></article>
          <article className="setup-card"><span className={checks.facebookEntertainment ? "check-dot good" : "check-dot"} /><div><strong>Facebook — Hiburan</strong><p>Atur <code>FB_ENTERTAINMENT_PAGE_ID</code> dan <code>FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN</code> untuk Page hiburan dari <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">Meta for Developers</a>.</p></div><b>{checks.facebookEntertainment ? "Tersedia" : "Belum diatur"}</b></article>
        </div>
        <p className="muted small-note">Simpan nilai rahasia hanya di Vercel → Project → Settings → Environment Variables, lalu deploy ulang. Dashboard tidak meminta atau menyimpan API key/token. Status “tersedia” hanya memeriksa keberadaan variabel, bukan menguji izin atau validitas token.</p>
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
          <p className="muted small-note">Feed Google News preset dan HanCinema ditambahkan nonaktif: Google News membatasi penggunaan feed di luar pembaca pribadi, sementara feed HanCinema tampak tertinggal. Tinjau sebelum mengaktifkan.</p>

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
          <div className="panel-heading"><div><p className="eyebrow">ANTREAN TERBARU</p><h2>Artikel</h2></div><div className="queue-counts"><span>{data?.stats.queued ?? 0} antre</span><span>{data?.stats.published ?? 0} terbit</span></div></div>
          {data?.articles.length ? <div className="article-list">{data.articles.map((article) => (
            <article className="article-row" key={article.id}>
              <div className="article-row-top"><span className={`tag ${article.pageKey}`}>{pageLabel(article.pageKey)}</span><span className={`status-tag ${article.status}`}>{article.status}</span></div>
              <strong>{article.title}</strong>
              <div className="article-meta">{article.sourceName} · {article.category} · {formatDate(article.createdAt)}</div>
              {article.errorMessage && <p className="article-error">{article.errorMessage}</p>}
              <a className="article-source" href={article.sourceUrl} target="_blank" rel="noreferrer">Buka sumber ↗</a>
            </article>
          ))}</div> : <div className="empty-state"><strong>Belum ada artikel.</strong><span>Tambahkan feed lalu jalankan panen untuk mengisi antrean. Jadwal publisher hanya mengambil dari antrean ini.</span></div>}
          <button type="button" onClick={() => void harvestNow()} disabled={busy} className="secondary-button run-button">{busy ? "Memproses…" : "Panen RSS sekarang (tidak menerbitkan)"}</button>
          {canPublish && <button type="button" onClick={() => void publishOne()} disabled={busy} className="primary-button run-button">{busy ? "Memproses…" : "Proses & terbitkan 1 berita"}</button>}
          {!canPublish && <p className="muted small-note">Tombol publikasi akan aktif setelah feed, Gemini, URL aplikasi, dan kredensial Facebook untuk halaman tujuan siap.</p>}
        </section>
      </div>

      <footer className="dashboard-footer"><span>News FB Fiesta · Neon Postgres</span><span>Posting otomatis dapat menerbitkan konten sungguhan. Periksa feed dan izin gambar sebelum mengaktifkan jadwal.</span></footer>
    </main>
  );
}
