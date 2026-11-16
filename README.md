# News FB Fiesta

Backend Next.js untuk alur **RSS → cuplikan artikel (scrape aman, fallback RSS) → caption AI (Groq → Gemini → Gemini cadangan) → news card 1080×1350 → antrean Buffer → Facebook Page**. Satu database **Neon Postgres** melalui `DATABASE_URL` melayani dua channel publikasi: `news` dan `entertainment`. Supabase tidak dibutuhkan. Aplikasi ini tidak membuat video Reels.

> Repository tidak menyimpan kredensial. Hubungkan Neon lewat `DATABASE_URL`; daftar RSS dikelola dari Dashboard aplikasi dan disimpan di Neon. API AI dan Buffer diatur di Vercel Environment Variables.

## Yang sudah dibuat

- Dashboard admin untuk mengelola feed RSS langsung di aplikasi; tiap feed diarahkan ke channel `news` atau `entertainment` dan disimpan di tabel `rss_sources`.
- Preset satu-klik untuk sumber hiburan dari daftar awal, termasuk filter kata kunci per feed; feed Google News dan HanCinema masuk nonaktif untuk ditinjau terlebih dahulu.
- Panen RSS harian terpisah dari jadwal publikasi; artikel hasil panen masuk antrean Neon, bukan langsung diposting.
- Deduplicasi URL sumber dengan SHA-256 dan unique index di Neon; setiap artikel menyimpan `page_key` tujuan.
- Saat panen, sistem mencoba mengambil 1–2 paragraf artikel dan `og:image` dengan batas waktu, ukuran, HTTPS, dan redirect; jika gagal/diblokir, memakai cuplikan RSS.
- Ringkasan bahasa Indonesia melalui failover Groq → Gemini utama → Gemini cadangan. Caption memakai hook, fakta/konteks berbasis sumber, CTA netral, serta hashtag yang relevan.
- Kartu berita vertikal 1080×1350 pada `/api/og/{articleId}`; prioritas gambar: RSS → `og:image` → latar fallback lokal. Logo Nusabeez/Popbeez tertanam dari aset proyek.
- Mengirim foto + caption ke antrean Buffer pada channel Facebook Page sesuai `page_key`; Buffer menerbitkan otomatis mengikuti jadwal channel. URL sumber masuk sebagai komentar pertama.
- Endpoint cron yang dilindungi `CRON_SECRET`, endpoint health check, dan endpoint untuk memasukkan ulang artikel gagal.
- GitHub Actions workflow untuk panen RSS setiap hari pukul 07.00 WITA dan mengirim maksimal satu artikel yang memenuhi batas ke antrean Buffer pada percobaan pukul :00 serta :15 setiap jam.

Panen menyimpan maksimal 50 artikel baru per hari ke antrean `queued` di Neon; deduplikasi URL mencegah artikel yang sama masuk dua kali. Saat panen, sistem mencoba mengambil maksimal dua paragraf isi artikel (maks. 1.500 karakter) dan foto `og:image`; jika gagal atau diblokir, sistem tetap memakai teks/gambar RSS. Publisher mengirim maksimal satu artikel per siklus ke antrean Buffer, tidak mengambil feed saat proses rilis, dan menerapkan batas maksimal **2 pengiriman dalam 60 menit** dengan jeda minimum **15 menit**. Dengan antrean penuh, batas teoritisnya 48 post Buffer per hari; Buffer sendiri menerbitkannya sesuai slot jadwal channel. Pastikan feed menyediakan konten yang cukup dan atur jadwal Buffer sesuai volume yang diinginkan. Feed yang gagal dicatat di dashboard; berita RSS lebih lama dari 72 jam dilewati.

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
- `GROQ_API_KEY`: opsional, penyedia AI pertama yang dicoba.
- `GROQ_MODEL`: opsional, preferensi model Groq. Aplikasi memeriksa katalog model akun secara otomatis, mengutamakan model ekonomis seperti `llama-3.1-8b-instant`, dan beralih jika model tidak tersedia.
- `GEMINI_API_KEY`: key Gemini utama, dicoba jika Groq gagal.
- `GEMINI_API_KEY_FALLBACK`: key Gemini cadangan, dicoba jika key Gemini utama gagal.
- `GEMINI_MODEL`: opsional, preferensi model Gemini. Aplikasi hanya memakai model yang terdaftar dan mendukung `generateContent`, lalu mencoba kandidat Flash/Flash-Lite yang hemat.

Aplikasi memeriksa ketersediaan model per key saat proses generasi, memilih kandidat yang terdaftar, dan mencoba model berikutnya jika model gagal. Pilihan awal memprioritaskan model kecil berbiaya rendah; keluaran dibatasi 350 token. `GROQ_MODEL` dan `GEMINI_MODEL` tetap opsional sebagai preferensi yang hanya dipakai jika tersedia. Dashboard menampilkan model konfigurasi dan status percobaan AI; log diagnostik menampilkan provider, model, waktu, status HTTP dan pesan aman tanpa nilai API key. Kegagalan provider atau format hasil mengaktifkan provider berikutnya.
- `BUFFER_API_KEY`: API key Buffer (Bearer token), simpan hanya sebagai environment variable Vercel.
- `BUFFER_NEWS_CHANNEL_ID`: ID channel Facebook Page berita yang sudah terhubung ke Buffer.
- `BUFFER_ENTERTAINMENT_CHANNEL_ID`: ID channel Facebook Page hiburan yang sudah terhubung ke Buffer.
- `APP_URL`: URL HTTPS deployment publik tanpa slash di akhir. Buffer mengambil news card dari URL ini.
- `PAGE_BRAND_NEWS`, `PAGE_BRAND_ENTERTAINMENT`: nama yang dicetak pada kartu masing-masing Page.
- Logo default tersedia di `public/brand/nusabeez_icon.png` dan `public/brand/popbeez_icon.png`; URL custom per Page bisa diatur lewat `PAGE_LOGO_NEWS_URL` atau `PAGE_LOGO_ENTERTAINMENT_URL`, dengan `PAGE_LOGO_URL` sebagai fallback bersama.
- Kredensial Graph API Facebook lama hanya diperlukan untuk endpoint retry komentar dari postingan langsung lama; alur baru tidak memerlukan Page Access Token Meta.

### Hubungkan Buffer

1. Di Buffer, hubungkan kedua Facebook Page sebagai channel, pastikan masing-masing Page memiliki jadwal otomatis dan koneksi channel tidak terputus.
2. Buat API key melalui [Buffer Developer Portal](https://developers.buffer.com/) dan simpan sebagai `BUFFER_API_KEY` di Vercel Production.
3. Deploy ulang, buka dashboard News FB Fiesta, lalu tekan **Tampilkan ID channel Buffer (hanya baca)**. Pilih baris channel Facebook Page yang benar, lalu salin ID channel-nya.
4. Tambahkan ID ke `BUFFER_NEWS_CHANNEL_ID` dan `BUFFER_ENTERTAINMENT_CHANNEL_ID` di Vercel Production, kemudian deploy ulang lagi.
5. Dashboard menandai variabel Buffer tersedia jika API key dan ID channel halaman tujuan ada. Tekan **Tes Buffer & tampilkan ID channel (hanya baca)** untuk benar-benar menguji akses API dan mencocokkan setiap ID ke Facebook Page yang aktif; pemeriksaan ini tidak membuat post. Ringkasan respons publisher berikutnya terlihat di GitHub Actions → workflow run → Summary.

Aplikasi membuat post dengan mode **Add to Queue**. Pastikan channel Facebook Page Buffer diatur untuk auto-publishing, bukan notifikasi manual, jika ingin publikasi otomatis. Batas/rencana API dan ketersediaannya mengikuti akun Buffer. Tidak perlu membuat Meta App/Page Access Token untuk alur posting lewat Buffer. Daftar RSS tetap dikelola di dashboard aplikasi dan disimpan di Neon; feed Google News/HanCinema yang dipreset nonaktif harus ditinjau dulu.

Satu database Neon menyimpan semua artikel beserta `page_key`; tidak perlu membuat database kedua. API key Buffer dan channel ID disimpan di Vercel, bukan di Neon.

## 3. Deploy dan aktifkan jadwal

1. Push branch/repository ke GitHub dan hubungkan project ke Vercel sebagai Next.js.
2. Tambahkan environment variables di Vercel dan deploy. `APP_URL` harus sama dengan URL deployment publik.
3. Di repository GitHub → **Settings → Secrets and variables → Actions → Secrets**, tambahkan:
   - `APP_URL` — URL Vercel, misalnya `https://nama-project.vercel.app`.
   - `CRON_SECRET` — nilai yang sama dengan environment variable Vercel.
4. Setelah workflow tersedia pada branch default GitHub, **Daily RSS harvest** berjalan pukul 07.00 WITA dan **Trigger news publisher** mencoba mengirim satu artikel ke antrean Buffer pada menit :00 dan :15 setiap jam. GitHub Actions memakai UTC dan dapat terlambat beberapa menit. Jalankan `Daily RSS harvest` manual untuk mengisi antrean Neon. `Trigger news publisher` mengirim konten ke Buffer; Buffer menerbitkannya sesuai jadwal channel.

Schedule GitHub hanya aktif dari branch default. Panen manual hanya menyimpan berita ke antrean Neon. Siklus publisher manual mengirim post sungguhan ke antrean Buffer; Buffer dapat menerbitkannya otomatis sesuai jadwal Page. Batas per jam dan jeda minimum tetap berlaku.

## Dashboard dan endpoint

Dashboard di `/` meminta `CRON_SECRET` sebelum menampilkan data. Di dalamnya kamu dapat mengimpor preset hiburan, menambah feed dengan filter kata kunci, menonaktifkan dan menghapus feed, melihat antrean artikel, menjalankan panen manual (tidak menerbitkan), membaca daftar channel Buffer secara read-only, dan menjalankan tes AI eksplisit yang menghabiskan sedikit kuota tetapi tidak menyimpan atau menerbitkan konten. Dashboard menampilkan ID model konfigurasi dan status percobaan AI; keberadaan key saja tidak berarti key/model valid. API key dan ID channel Buffer disimpan di Vercel Environment Variables—dashboard tidak meminta atau menyimpan API key. Tombol kirim manual hanya muncul saat konfigurasi siap; tombol itu mengirim post ke antrean Buffer, dan Buffer dapat menerbitkannya otomatis mengikuti jadwal channel.

- `GET /api/dashboard` — ringkasan admin (wajib bearer secret).
- `POST/PATCH/DELETE /api/admin/feeds` — kelola RSS dari dashboard (wajib bearer secret).
- `POST /api/admin/feeds/import-presets` — masukkan preset hiburan (wajib bearer secret).
- `GET /api/admin/buffer/channels` — baca nama dan ID channel Buffer (wajib bearer secret; tidak membuat post).
- `POST /api/admin/diagnostics/ai` — uji satu kali pembuatan teks melalui failover AI dengan prompt sintetis; memakai kuota provider, tidak menyimpan hasil, dan tidak mengirim ke Buffer (wajib bearer secret).
- `POST /api/harvest` — ambil RSS dan isi antrean tanpa publikasi (wajib bearer secret).
- `GET /api/health` — tes koneksi database dan melihat status integrasi (hanya status ada/tidak, bukan rahasia).
- `GET /api/cron` — proses satu artikel dan kirim ke antrean Buffer; mematuhi batas 2 pengiriman/jam dan jeda 15 menit. Wajib header `Authorization: Bearer <CRON_SECRET>`. Buffer mengatur waktu publikasi akhir.
- `POST /api/admin/retry` — memasukkan kembali artikel berstatus `failed` ke antrean. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `POST /api/admin/retry-comment` — mengulang komentar sumber untuk postingan yang sudah terbit. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `GET /api/og/{articleId}` — gambar news card untuk artikel tersimpan.

Contoh uji manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"
```

Jangan memanggil endpoint cron berulang-ulang untuk tes di production: setiap artikel berhasil akan ditambahkan ke antrean Buffer dan dapat diterbitkan otomatis oleh Buffer.

## Pemeriksaan dan catatan penting

```bash
npm run typecheck
npm run lint
npm run build
```

Artikel yang gagal tersimpan dengan status `failed`; setelah memperbaiki konfigurasi, masukkan ulang dengan endpoint retry. Setelah Buffer menerima post, artikel ditandai `ready` dengan referensi antrean Buffer supaya tidak dikirim ulang oleh siklus cron berikutnya. Dashboard membedakannya sebagai **Antrean Buffer**; status publikasi aktual dapat dilihat di Buffer.

Ringkasan AI tidak menjamin kebenaran atau verifikasi fakta. Periksa kualitas feed dan hasil secara berkala. Gunakan hanya teks dan gambar yang penggunaannya diizinkan; **menaruh tautan sumber di komentar tidak otomatis menghapus kewajiban hak cipta atau kebijakan Meta**. Pertimbangkan review manual sebelum publikasi otomatis.
