# News FB Fiesta

Backend Next.js untuk alur **RSS → ringkasan Gemini → news card 1080×1350 → Facebook Page**. Database memakai **Neon Postgres** melalui `DATABASE_URL`; Supabase tidak dibutuhkan. Aplikasi ini tidak membuat video Reels.

> Ini adalah kerangka aplikasi yang perlu dikonfigurasi dengan akun dan kredensial milikmu. Belum ada feed, token Meta, API key Gemini, atau database yang terpasang di repository.

## Yang sudah dibuat

- RSS reader dengan daftar feed/kategori yang bisa diatur lewat `NEWS_FEEDS`.
- Deduplicasi URL sumber dengan SHA-256 dan unique index di Neon.
- Ringkasan bahasa Indonesia menggunakan Gemini: judul, tepat tiga paragraf pendek, dan pertanyaan penutup.
- Kartu berita dinamis vertikal 1080×1350 pada `/api/og/{articleId}`; memakai gambar RSS jika tersedia.
- Unggah foto + caption ke Facebook Page, lalu komentar berisi URL sumber.
- Endpoint cron yang dilindungi `CRON_SECRET`, endpoint health check, dan endpoint untuk memasukkan ulang artikel gagal.
- GitHub Actions workflow untuk pemanggilan terjadwal setiap dua jam selama jam aktif WITA.

Pipeline memproses **maksimal satu berita per pemanggilan** agar eksekusi tetap terkendali. Feed yang gagal dicatat di log dan feed lain tetap dicoba. Berita RSS lama dari lebih dari 72 jam dilewati. Hanya teks yang tersedia di RSS yang diberikan ke Gemini; kode tidak mengambil isi artikel penuh dari website sumber.

## 1. Siapkan database Neon (kamu yang memasang)

1. Buat database PostgreSQL di Neon atau melalui Vercel Marketplace.
2. Ambil **pooled connection string** Neon (`postgresql://...`, SSL aktif).
3. Buat tabel dengan salah satu cara berikut:
   - Jalankan `npm install`, isi `DATABASE_URL` di `.env.local`, lalu jalankan `npm run db:push`; atau
   - Buka Neon SQL Editor dan jalankan isi file [`drizzle/schema.sql`](./drizzle/schema.sql).
4. Pastikan `DATABASE_URL` yang sama sudah ditambahkan di Vercel untuk Production (dan Preview jika diperlukan).

Jangan kirim connection string ke chat atau commit ke Git.

## 2. Siapkan environment variables

Salin `.env.example` ke `.env.local` untuk pengujian lokal. Tambahkan variabel yang sama di **Vercel → Project → Settings → Environment Variables** untuk deployment.

- `DATABASE_URL`: connection string pooled Neon.
- `CRON_SECRET`: nilai acak panjang, minimal 32 karakter. Lindungi seperti password.
- `GEMINI_API_KEY`: API key Google AI Studio; `GEMINI_MODEL` opsional (default `gemini-2.5-flash`).
- `FB_PAGE_ID`, `FB_PAGE_ACCESS_TOKEN`: identitas dan Page Access Token Facebook Page.
- `FB_GRAPH_VERSION`: versi Graph API yang didukung akun Meta-mu, format `vNN.0`.
- `APP_URL`: URL HTTPS deployment publik tanpa slash di akhir. Dipakai Facebook untuk mengambil gambar.
- `PAGE_BRAND`: nama halaman yang dicetak di kartu.
- `PAGE_LOGO_URL`: opsional, URL HTTPS publik untuk logo. Jika kosong, kartu menampilkan monogram.
- `NEWS_FEEDS`: JSON array konfigurasi RSS, contohnya:

```json
[
  {"name":"Nama Sumber Bali","category":"BALI","url":"https://domain-sumber.example/rss.xml","language":"id"},
  {"name":"Nama Sumber Drakor","category":"DRAKOR","url":"https://domain-sumber.example/feed.xml","language":"en"}
]
```

Ganti URL contoh dengan endpoint RSS yang benar dan diizinkan oleh masing-masing penerbit. Kategori bebas, misalnya `BALI`, `NTB`, `NTT`, `DRAKOR`, `DRACIN`. `MAX_ITEMS_PER_FEED` opsional (default 8, maksimal 20).

Untuk Facebook, pastikan Meta App/Page memiliki izin yang diperlukan untuk memublikasikan foto dan membuat komentar (umumnya `pages_manage_posts` dan `pages_manage_engagement`; proses mendapatkan Page token dapat memerlukan izin tambahan). Uji dengan Page yang kamu kelola. Token yang tidak punya izin atau kedaluwarsa akan membuat proses gagal.

## 3. Deploy dan aktifkan jadwal

1. Push branch/repository ke GitHub dan hubungkan project ke Vercel sebagai Next.js.
2. Tambahkan environment variables di Vercel dan deploy. `APP_URL` harus sama dengan URL deployment publik.
3. Di repository GitHub → **Settings → Secrets and variables → Actions → Secrets**, tambahkan:
   - `APP_URL` — URL Vercel, misalnya `https://nama-project.vercel.app`.
   - `CRON_SECRET` — nilai yang sama dengan environment variable Vercel.
4. Setelah workflow tersedia pada branch default GitHub, schedule akan berjalan pukul **07.00, 09.00, …, 23.00 WITA**. GitHub Actions menggunakan UTC; jadwal dapat terlambat beberapa menit. Kamu juga bisa menjalankannya manual dari tab Actions → **Trigger news publisher** → Run workflow.

Schedule GitHub hanya aktif dari branch default. Jangan aktifkan sebelum konfigurasi lengkap; pemanggilan manual pertama dapat membuat posting sungguhan di Facebook.

## Endpoint

- `GET /api/health` — tes koneksi database dan melihat status integrasi (hanya status ada/tidak, bukan rahasia).
- `GET /api/cron` — satu siklus RSS sampai posting. Wajib header `Authorization: Bearer <CRON_SECRET>`.
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
