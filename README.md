# News FB Fiesta

Backend Next.js untuk alur **RSS → ringkasan Gemini → news card 1080×1350 → Facebook Page**. Satu database **Neon Postgres** melalui `DATABASE_URL` melayani dua channel publikasi: `news` dan `entertainment`. Supabase tidak dibutuhkan. Aplikasi ini tidak membuat video Reels.

> Repository tidak menyimpan kredensial. Hubungkan Neon lewat `DATABASE_URL`; daftar RSS dikelola dari Dashboard aplikasi dan disimpan di Neon. API Gemini dan Meta tetap di Vercel Environment Variables.

## Yang sudah dibuat

- Dashboard admin untuk mengelola feed RSS langsung di aplikasi; tiap feed diarahkan ke channel `news` atau `entertainment` dan disimpan di tabel `rss_sources`.
- Preset satu-klik untuk sumber hiburan dari daftar awal, termasuk filter kata kunci per feed; feed Google News dan HanCinema masuk nonaktif untuk ditinjau terlebih dahulu.
- Panen RSS harian terpisah dari jadwal publikasi; artikel hasil panen masuk antrean Neon, bukan langsung diposting.
- Deduplicasi URL sumber dengan SHA-256 dan unique index di Neon; setiap artikel menyimpan `page_key` tujuan.
- Ringkasan bahasa Indonesia menggunakan Gemini: judul, tepat tiga paragraf pendek, dan pertanyaan penutup.
- Kartu berita dinamis vertikal 1080×1350 pada `/api/og/{articleId}`; memakai gambar RSS jika tersedia.
- Unggah foto + caption ke Facebook Page yang sesuai dengan `page_key`, lalu komentar berisi URL sumber.
- Endpoint cron yang dilindungi `CRON_SECRET`, endpoint health check, dan endpoint untuk memasukkan ulang artikel gagal.
- GitHub Actions workflow untuk panen RSS setiap hari pukul 08.00 WITA dan mencoba publikasi pukul :00 serta :15 setiap jam.

Panen menyimpan maksimal 50 artikel baru per hari ke antrean `queued` di Neon; deduplikasi URL mencegah artikel yang sama masuk dua kali. Publisher mengambil maksimal satu artikel per siklus, tidak mengambil feed saat proses rilis, dan menerapkan batas maksimal **2 posting dalam 60 menit** dengan jeda minimum **15 menit**. Dengan antrean penuh, batas teoritisnya 48 posting per hari, jadi pastikan feed menyediakan konten yang cukup dan sesuaikan jumlah feed/cadence bila tidak ingin posting sebanyak itu. Feed yang gagal dicatat di dashboard; berita RSS lebih lama dari 72 jam dilewati. Hanya teks yang tersedia di RSS yang diberikan ke Gemini, bukan isi halaman artikel penuh.

## 1. Siapkan database Neon (kamu yang memasang)

1. Buat database PostgreSQL di Neon atau melalui Vercel Marketplace.
2. Ambil **pooled connection string** Neon (`postgresql://...`, SSL aktif).
3. Jika tabel `articles` belum ada, buat skema awal dengan salah satu cara berikut:
   - Jalankan `npm install`, isi `DATABASE_URL` di `.env.local`, lalu jalankan `npm run db:push`; atau
   - Buka Neon SQL Editor dan jalankan isi file [`drizzle/schema.sql`](./drizzle/schema.sql).
4. Jika tabel `articles` sudah ada dari skema versi sebelumnya, jalankan sekali file [`drizzle/0001_multi_page.sql`](./drizzle/0001_multi_page.sql) di Neon SQL Editor. Kolom baru `page_key` untuk artikel lama otomatis bernilai `news`.
5. Jalankan file [`drizzle/0002_rss_sources.sql`](./drizzle/0002_rss_sources.sql) untuk membuat tabel feed RSS yang dikelola dari Dashboard. Jika database belum memiliki tabel `articles`, gunakan `drizzle/schema.sql` yang sudah mencakup kedua tabel.
6. Jalankan [`drizzle/0003_scheduled_harvest.sql`](./drizzle/0003_scheduled_harvest.sql) untuk menambahkan filter kata kunci dan pengunci publisher.
7. Pastikan `DATABASE_URL` yang sama tersedia di Vercel Production; Preview juga perlu jika kamu akan mengetes preview deployments.

Jangan kirim connection string ke chat atau commit ke Git.

## 2. Siapkan environment variables

Salin `.env.example` ke `.env.local` untuk pengujian lokal. Tambahkan variabel yang sama di **Vercel → Project → Settings → Environment Variables** untuk deployment.

- `DATABASE_URL`: connection string pooled Neon.
- `CRON_SECRET`: nilai acak panjang, minimal 32 karakter. Lindungi seperti password.
- `GEMINI_API_KEY`: API key Google AI Studio; `GEMINI_MODEL` opsional (default `gemini-3.8-flash`).
- `FB_NEWS_PAGE_ID`, `FB_NEWS_PAGE_ACCESS_TOKEN`: kredensial Page berita.
- `FB_ENTERTAINMENT_PAGE_ID`, `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN`: kredensial Page hiburan.
- `FB_GRAPH_VERSION`: versi Graph API yang didukung akun Meta-mu, format `vNN.0`.
- `APP_URL`: URL HTTPS deployment publik tanpa slash di akhir. Dipakai Facebook untuk mengambil gambar.
- `PAGE_BRAND_NEWS`, `PAGE_BRAND_ENTERTAINMENT`: nama yang dicetak pada kartu masing-masing Page.
- `PAGE_LOGO_NEWS_URL`, `PAGE_LOGO_ENTERTAINMENT_URL`: opsional, logo HTTPS per Page; `PAGE_LOGO_URL` bisa menjadi fallback bersama.
Daftar RSS tidak perlu dimasukkan ke environment variables. Buka halaman utama aplikasi, masuk memakai `CRON_SECRET`, lalu tambahkan nama sumber, kategori, URL RSS, bahasa, halaman tujuan, dan kata kunci filter opsional. Tombol **Tambahkan preset hiburan** memasukkan sumber dari daftar awal ke Neon; Google News dan HanCinema ditambahkan nonaktif agar ditinjau sebelum dipakai. Feed Google News RSS mengandung batas penggunaan yang perlu diperiksa sebelum mengaktifkan untuk publikasi Facebook.

ID dan access token kedua Page **disimpan terpisah sebagai environment variables Vercel, bukan di Neon**. Satu database menyimpan semua artikel beserta `page_key`; tidak perlu membuat database kedua.

Untuk Facebook, pastikan Meta App/Page memiliki izin yang diperlukan untuk memublikasikan foto dan membuat komentar (umumnya `pages_manage_posts` dan `pages_manage_engagement`; proses mendapatkan Page token dapat memerlukan izin tambahan). Uji dengan Page yang kamu kelola. Token yang tidak punya izin atau kedaluwarsa akan membuat proses gagal.

## 3. Deploy dan aktifkan jadwal

1. Push branch/repository ke GitHub dan hubungkan project ke Vercel sebagai Next.js.
2. Tambahkan environment variables di Vercel dan deploy. `APP_URL` harus sama dengan URL deployment publik.
3. Di repository GitHub → **Settings → Secrets and variables → Actions → Secrets**, tambahkan:
   - `APP_URL` — URL Vercel, misalnya `https://nama-project.vercel.app`.
   - `CRON_SECRET` — nilai yang sama dengan environment variable Vercel.
4. Setelah workflow tersedia pada branch default GitHub, **Daily RSS harvest** berjalan pukul 07.00 WITA dan **Trigger news publisher** mencoba rilis pukul :00 dan :15 setiap jam. GitHub Actions memakai UTC dan dapat terlambat beberapa menit. Jalankan `Daily RSS harvest` manual untuk mengisi antrean, atau `Trigger news publisher` untuk memublikasikan maksimal satu berita.

Schedule GitHub hanya aktif dari branch default. Panen manual hanya menyimpan berita ke antrean; publisher manual dapat membuat posting sungguhan di Facebook. Batas per jam dan jeda minimum tetap berlaku.

## Dashboard dan endpoint

Dashboard di `/` meminta `CRON_SECRET` sebelum menampilkan data. Di dalamnya kamu dapat mengimpor preset hiburan, menambah feed dengan filter kata kunci, menonaktifkan dan menghapus feed; melihat antrean artikel; serta memakai tombol panen manual yang **hanya** mengantrekan dan tidak menerbitkan. Dashboard menyediakan panduan konfigurasi Gemini/Facebook dan indikator variabel tersedia. API key dan Page token tetap harus dimasukkan di Vercel Environment Variables—dashboard tidak mengumpulkan atau menyimpan nilainya. Tombol penerbitan manual hanya muncul saat konfigurasi dasar tersedia dan tetap dibatasi cadence; ia dapat membuat posting Facebook sungguhan.

- `GET /api/dashboard` — ringkasan admin (wajib bearer secret).
- `POST/PATCH/DELETE /api/admin/feeds` — kelola RSS dari dashboard (wajib bearer secret).
- `POST /api/admin/feeds/import-presets` — masukkan preset hiburan (wajib bearer secret).
- `POST /api/harvest` — ambil RSS dan isi antrean tanpa publikasi (wajib bearer secret).
- `GET /api/health` — tes koneksi database dan melihat status integrasi (hanya status ada/tidak, bukan rahasia).
- `GET /api/cron` — ambil satu artikel dari antrean dan coba publikasikan; mematuhi batas 2/jam dan jeda 15 menit. Wajib header `Authorization: Bearer <CRON_SECRET>`.
- `POST /api/admin/retry` — memasukkan kembali artikel berstatus `failed` ke antrean. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `POST /api/admin/retry-comment` — mengulang komentar sumber untuk postingan yang sudah terbit. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `GET /api/og/{articleId}` — gambar news card untuk artikel tersimpan.

Contoh uji manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"
```

Jangan memanggil endpoint cron berulang-ulang untuk tes di production: setiap berita yang berhasil diproses akan diposting ke Page.

## Pemeriksaan dan catatan penting

```bash
npm run typecheck
npm run lint
npm run build
```

Artikel yang gagal tersimpan dengan status `failed`; setelah memperbaiki konfigurasi, masukkan ulang dengan endpoint retry. Kalau postingan foto berhasil tetapi komentar sumber gagal, status tetap `published` agar retry tidak menerbitkan foto duplikat; error komentar tercatat di database.

Ringkasan AI tidak menjamin kebenaran atau verifikasi fakta. Periksa kualitas feed dan hasil secara berkala. Gunakan hanya teks dan gambar yang penggunaannya diizinkan; **menaruh tautan sumber di komentar tidak otomatis menghapus kewajiban hak cipta atau kebijakan Meta**. Pertimbangkan review manual sebelum publikasi otomatis.
