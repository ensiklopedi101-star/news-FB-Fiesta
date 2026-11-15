const steps = [
  { number: "01", title: "Ambil berita dari RSS", detail: "Feed yang kamu tentukan dipindai; URL sumber dinormalisasi dan dideduplikasi." },
  { number: "02", title: "Tulis ringkasan dengan Gemini", detail: "Dibuat dalam bahasa Indonesia: judul, tiga paragraf pendek, dan pertanyaan diskusi." },
  { number: "03", title: "Buat news card 1080 × 1350", detail: "Kartu otomatis memakai foto dari feed bila tersedia, kategori, judul, dan nama halaman." },
  { number: "04", title: "Terbitkan ke Facebook Page", detail: "Foto dan caption diposting; URL artikel ditambahkan ke komentar pertama." },
];

export default function Home() {
  const brand = process.env.PAGE_BRAND || "News FB Fiesta";
  return (
    <main className="shell">
      <header className="topbar"><div className="brand-mark">N</div><span>{brand}</span><span className="badge">NEWS AUTOMATION</span></header>
      <section className="hero">
        <p className="eyebrow">ASISTEN REDAKSI OTOMATIS</p>
        <h1>Dari feed berita<br /><span>menjadi news card.</span></h1>
        <p className="intro">Backend ini mengumpulkan berita RSS, menyiapkan ringkasan berbahasa Indonesia, merender poster vertikal, dan menerbitkan foto beserta caption ke Facebook Page.</p>
        <div className="actions"><a className="button primary" href="/api/health">Periksa konfigurasi API <span>↗</span></a><a className="button secondary" href="https://vercel.com/docs/marketplace-storage" target="_blank" rel="noreferrer">Panduan database Neon <span>↗</span></a></div>
      </section>
      <section className="process" aria-label="Alur sistem">
        <div className="section-heading"><div><p className="eyebrow">ALUR PUBLIKASI</p><h2>Empat langkah di belakang layar</h2></div><span className="schedule">JADWAL: GitHub Actions</span></div>
        <div className="steps">{steps.map((step) => <article className="step" key={step.number}><span className="step-number">{step.number}</span><h3>{step.title}</h3><p>{step.detail}</p></article>)}</div>
      </section>
      <section className="setup">
        <div><p className="eyebrow">SEBELUM AKTIF</p><h2>Hubungkan layananmu</h2><p>Database Neon dan API eksternal dipasang oleh pemilik akun. Simpan seluruh kunci sebagai environment variables di Vercel—jangan di source code.</p></div>
        <ul><li><span>DATABASE_URL</span><small>Neon Postgres (pooled connection string)</small></li><li><span>GEMINI_API_KEY</span><small>Ringkasan dan terjemahan berita</small></li><li><span>FB_PAGE_ID + FB_PAGE_ACCESS_TOKEN</span><small>Publikasi ke Facebook Page</small></li><li><span>CRON_SECRET + NEWS_FEEDS + APP_URL</span><small>Pengaman job, daftar RSS, dan URL poster</small></li></ul>
      </section>
      <footer><span>News FB Fiesta · Next.js + Neon Postgres</span><span>Ringkasan AI perlu ditinjau; gunakan hanya feed dan gambar yang penggunaannya diizinkan.</span></footer>
    </main>
  );
}
