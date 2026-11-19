# News FB Fiesta

Backend Next.js untuk alur **RSS → cuplikan artikel (scrape aman, fallback RSS) → caption AI (Groq → Gemini → Gemini cadangan) → news card 1080×1350 → antrean Buffer → Facebook Page**. Satu database **Neon Postgres** melalui `DATABASE_URL` melayani dua channel publikasi: `news` dan `entertainment`. Supabase tidak dibutuhkan. Aplikasi ini tidak membuat video Reels.

> Repository tidak menyimpan kredensial. Hubungkan Neon lewat `DATABASE_URL`; daftar RSS dikelola dari Dashboard aplikasi dan disimpan di Neon. API AI dan Buffer diatur di Vercel Environment Variables.

## Yang sudah dibuat

- Dashboard admin untuk mengelola feed RSS langsung di aplikasi; tiap feed diarahkan ke channel `news` atau `entertainment` dan disimpan di tabel `rss_sources`.
- Preset satu-klik hiburan mencakup Soompi All News, Seoulbeats, dan MyDramaList News, sumber khusus C-Drama (DramaPanda C-News, Overseasidol), donghua (Yu Alexius, My Donghua Review), dan K-pop/idol (Soompi Music, Yonhap Culture/K-pop), beserta filter kata kunci per feed. Google News dan HanCinema tetap nonaktif untuk ditinjau terlebih dahulu.
- Panen RSS setiap 4 jam terpisah dari jadwal publikasi; artikel hasil panen masuk antrean Neon, bukan langsung diposting.
- Deduplicasi URL sumber dengan SHA-256 dan unique index di Neon; setiap artikel menyimpan `page_key` tujuan.
- Saat panen, sistem mencoba mengambil 1–2 paragraf artikel dan `og:image` dengan batas waktu, ukuran, HTTPS, dan redirect; jika gagal/diblokir, memakai cuplikan RSS.
- Ringkasan bahasa Indonesia melalui failover Groq → Gemini utama → Gemini cadangan. Caption memakai hook, fakta/konteks berbasis sumber, CTA netral, serta hashtag yang relevan.
- News card satu gambar atau eksperimen carousel empat slide pada `/api/og/{articleId}`; 50% artikel baru mendapat varian carousel secara stabil berdasarkan hash URL, 50% tetap satu gambar sebagai pembanding. Slide carousel memuat cover, dua fakta ringkas bersumber, dan pertanyaan komunitas. Dashboard menandai format aktual; performa jangkauan/engagement masih perlu dibandingkan manual melalui Facebook Insights hingga Meta API tersedia. Logo Nusabeez/Popbeez tertanam dari aset proyek.
- Deteksi gambar RSS mencakup enclosure, Media RSS (termasuk media:group), `content:encoded`, description/summary, gambar lazy-load, dan srcset; fallback halaman artikel memakai `og:image`, lalu latar fallback lokal.
- Dashboard menampilkan pratinjau aktual news card, indikator apakah foto sumber ditemukan, status token Blob, serta hasil panen berupa jumlah foto terdeteksi dan berhasil disimpan ke Blob.
- Mengirim foto + caption ke antrean Buffer pada channel Facebook Page sesuai `page_key`; Buffer menerbitkan otomatis mengikuti jadwal channel. URL sumber disertakan di akhir caption agar kompatibel dengan paket Buffer tanpa fitur komentar pertama.
- Endpoint cron yang dilindungi `CRON_SECRET`, endpoint health check, dan endpoint untuk memasukkan ulang artikel gagal.
- Penjadwalan panen RSS dan pemicu publisher dilakukan oleh cron-job.org melalui endpoint aplikasi yang dilindungi `CRON_SECRET`; tidak menggunakan GitHub Actions.

Setiap siklus panen memproses maksimal 50 kandidat berita ke antrean `queued` di Neon; deduplikasi URL mencegah artikel yang sama masuk dua kali. Saat panen, sistem mencoba mengambil maksimal dua paragraf isi artikel (maks. 1.500 karakter) dan foto `og:image`; jika gagal atau diblokir, sistem tetap memakai teks/gambar RSS. Publisher mengirim maksimal satu artikel per siklus ke antrean Buffer, tidak mengambil feed saat proses rilis, dan menerapkan batas maksimal **2 pengiriman dalam 60 menit** dengan jeda minimum **15 menit**. Dengan antrean penuh, batas teoritisnya 48 post Buffer per hari; Buffer sendiri menerbitkannya sesuai slot jadwal channel. Pastikan feed menyediakan konten yang cukup dan atur jadwal Buffer sesuai volume yang diinginkan. Feed yang gagal dicatat di dashboard. Hanya berita yang berumur maksimal 7 jam sejak waktu terbit sumber yang dipertahankan; berita lebih lama otomatis dikeluarkan dari antrean. Jika feed RSS tidak menyediakan waktu terbit, umur dihitung sejak berita masuk ke sistem. Dashboard menampilkan nomor urutan antrean dan memungkinkan berita yang masih berstatus antre untuk dikeluarkan secara manual.

## 1. Siapkan database Neon (kamu yang memasang)

1. Buat database PostgreSQL di Neon atau melalui Vercel Marketplace.
2. Ambil **pooled connection string** Neon (`postgresql://...`, SSL aktif).
3. Jika tabel `articles` belum ada, buat skema awal dengan salah satu cara berikut:
   - Jalankan `npm install`, isi `DATABASE_URL` di `.env.local`, lalu jalankan `npm run db:push`; atau
   - Buka Neon SQL Editor dan jalankan isi file [`drizzle/schema.sql`](./drizzle/schema.sql).
4. Jika tabel `articles` sudah ada dari skema versi sebelumnya, jalankan sekali file [`drizzle/0001_multi_page.sql`](./drizzle/0001_multi_page.sql) di Neon SQL Editor. Kolom baru `page_key` untuk artikel lama otomatis bernilai `news`.
5. Jalankan file [`drizzle/0002_rss_sources.sql`](./drizzle/0002_rss_sources.sql) untuk membuat tabel feed RSS yang dikelola dari Dashboard. Jika database belum memiliki tabel `articles`, gunakan `drizzle/schema.sql` yang sudah mencakup kedua tabel.
6. Jalankan [`drizzle/0003_scheduled_harvest.sql`](./drizzle/0003_scheduled_harvest.sql) untuk menambahkan filter kata kunci dan pengunci publisher.
7. Jalankan [`drizzle/0004_fresh_queue.sql`](./drizzle/0004_fresh_queue.sql) untuk mencatat waktu terbit sumber, menandai berita kedaluwarsa, dan mengaktifkan status pengeluaran manual dari antrean.
8. Jalankan [`drizzle/0005_carousel_experiment.sql`](./drizzle/0005_carousel_experiment.sql) untuk menyimpan varian format dan teks slide carousel.
9. Jalankan [`drizzle/0006_article_image_gallery.sql`](./drizzle/0006_article_image_gallery.sql) untuk menyimpan hingga tiga foto artikel per berita; gambar utama yang sudah ada akan disalin sebagai fallback.
10. Jalankan [`drizzle/0007_queue_priority.sql`](./drizzle/0007_queue_priority.sql) untuk menambahkan pengaturan prioritas antrean.
11. Jalankan [`drizzle/0008_manual_images.sql`](./drizzle/0008_manual_images.sql) untuk mengaktifkan penggantian gambar manual pada artikel antrean.
11. Pastikan `DATABASE_URL` yang sama tersedia di Vercel Production; Preview juga perlu jika kamu akan mengetes preview deployments.

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
- `BLOB_READ_WRITE_TOKEN`: token akses Vercel Blob. Buat Blob Store pada project Vercel; Vercel akan memasang token ini sebagai environment variable. Proses panen menyimpan gambar artikel baru ke Blob dan memperbarui `articles.image_url` di Neon. Endpoint OG menormalkan gambar ke JPEG sebelum `ImageResponse` merendernya. Tidak ada migrasi schema.
- `PAGE_BRAND_NEWS`, `PAGE_BRAND_ENTERTAINMENT`: nama yang dicetak pada kartu masing-masing Page.
- Logo default tersedia di `public/brand/nusabeez_icon.png` dan `public/brand/popbeez_icon.png`; URL custom per Page bisa diatur lewat `PAGE_LOGO_NEWS_URL` atau `PAGE_LOGO_ENTERTAINMENT_URL`, dengan `PAGE_LOGO_URL` sebagai fallback bersama.
- `FB_ENTERTAINMENT_PAGE_ID` + `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN`: mengaktifkan publikasi langsung halaman hiburan (Popbeez) ke Facebook Graph API, termasuk review manual, tanpa Buffer. Token harus Page Access Token berumur panjang dengan izin `pages_manage_posts`. Halaman berita tetap memakai Buffer; `FB_NEWS_PAGE_ID`/`FB_NEWS_PAGE_ACCESS_TOKEN` hanya dipakai untuk retry komentar sumber.
- `FB_GRAPH_VERSION`: opsional, default `v23.0`.

### Hubungkan Vercel Blob

1. Di Vercel, buka project aplikasi → **Storage** → buat **Blob Store** dengan akses public, lalu hubungkan ke project.
2. Pastikan Vercel menambahkan `BLOB_READ_WRITE_TOKEN` ke environment **Production** (dan Preview jika ingin menguji preview deployment), lalu deploy ulang.
3. Jalankan panen RSS setelah Blob terhubung untuk menyimpan gambar artikel baru. Panen hanya mengambil berita dan tidak menerbitkan post. Endpoint `/api/og/<article-id>` lalu membaca gambar dari URL Blob di Neon dan merender kartu.

Berkas gambar disimpan di Vercel Blob; Neon hanya menyimpan URL. Upload terjadi saat panen, sekali per artikel dengan nama object deterministik.

### Jika news card tidak menampilkan foto

1. Pastikan feed RSS menyediakan gambar melalui enclosure, `media:content`, `media:thumbnail`, `content:encoded`, description/summary, atau halaman artikel dengan `og:image`. Aplikasi menolak URL gambar non-HTTPS dan jenis berkas yang tidak didukung.
2. Di Dashboard, jalankan **Panen RSS sekarang**. Hasil panen menunjukkan berapa foto terdeteksi dan berapa yang masuk Blob. Panel artikel juga menampilkan indikator gambar sumber dan pratinjau kartu akhir.
3. Jika foto terdeteksi tetapi pratinjau hanya menampilkan latar, buka foto sumber dan pastikan URL bisa diakses publik tanpa login/hotlink protection. Kartu menerima JPEG, PNG, atau WebP dengan batas ukuran 5 MB.
4. Pastikan `BLOB_READ_WRITE_TOKEN` tersedia pada environment deployment yang menjalankan panen. Bila token tidak tersedia, URL RSS tetap disimpan dan kartu mencoba mengambilnya langsung; upload ke Blob tidak akan terjadi.
5. Buka `/api/og/<article-id>` untuk memeriksa hasil PNG langsung. Nilai `image_url` berada di Neon; tabel/schema tidak perlu dimigrasikan untuk perubahan ini.

### Hubungkan Buffer

1. Di Buffer, hubungkan kedua Facebook Page sebagai channel, pastikan masing-masing Page memiliki jadwal otomatis dan koneksi channel tidak terputus.
2. Buat API key melalui [Buffer Developer Portal](https://developers.buffer.com/) dan simpan sebagai `BUFFER_API_KEY` di Vercel Production.
3. Deploy ulang, buka dashboard News FB Fiesta, lalu tekan **Tampilkan ID channel Buffer (hanya baca)**. Pilih baris channel Facebook Page yang benar, lalu salin ID channel-nya.
4. Tambahkan ID ke `BUFFER_NEWS_CHANNEL_ID` dan `BUFFER_ENTERTAINMENT_CHANNEL_ID` di Vercel Production, kemudian deploy ulang lagi.
5. Dashboard menandai variabel Buffer tersedia jika API key dan ID channel halaman tujuan ada. Tekan **Tes Buffer & tampilkan ID channel (hanya baca)** untuk benar-benar menguji akses API dan mencocokkan setiap ID ke Facebook Page yang aktif; pemeriksaan ini tidak membuat post. Hasil setiap pemanggilan terjadwal dapat diperiksa di riwayat eksekusi cron-job.org dan log Vercel.

### Publikasi langsung Facebook untuk Popbeez (opsional)

Jika `FB_ENTERTAINMENT_PAGE_ID` dan `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN` diisi, halaman hiburan menerbitkan langsung ke Facebook Graph API:

1. Satu gambar dikirim ke `POST /{page-id}/photos` dengan `published=true`.
2. Carousel diunggah sebagai beberapa foto `published=false`, lalu digabung lewat `POST /{page-id}/feed` dengan field `attached_media[0..n]`.
3. Status artikel langsung menjadi `published` dan ID posting Facebook disimpan di `facebook_post_id`.
4. Review manual Popbeez (enam slide) ikut memakai jalur langsung dan tidak dibatasi kuota Buffer.

Halaman berita tetap memakai Buffer. Jika dua variabel hiburan itu kosong, halaman hiburan otomatis kembali ke Buffer sehingga aplikasi tetap berjalan. Token dan Page ID hanya disimpan sebagai environment variable Vercel, bukan di Neon atau repositori.

Aplikasi membuat post dengan mode **Add to Queue**. Pastikan channel Facebook Page Buffer diatur untuk auto-publishing, bukan notifikasi manual, jika ingin publikasi otomatis. Batas/rencana API dan ketersediaannya mengikuti akun Buffer. Tidak perlu membuat Meta App/Page Access Token untuk alur posting lewat Buffer. Daftar RSS tetap dikelola di dashboard aplikasi dan disimpan di Neon; feed Google News/HanCinema yang dipreset nonaktif harus ditinjau dulu.

Satu database Neon menyimpan semua artikel beserta `page_key`; tidak perlu membuat database kedua. API key Buffer dan channel ID disimpan di Vercel, bukan di Neon.

## 3. Deploy dan aktifkan cron-job.org

1. Push branch/repository ke GitHub dan hubungkan project ke Vercel sebagai Next.js.
2. Tambahkan environment variables di Vercel dan deploy. `APP_URL` harus sama dengan URL deployment publik; `CRON_SECRET` harus terisi dan dirahasiakan.
3. Di [cron-job.org](https://cron-job.org/), buat dua tugas HTTPS. Untuk keduanya, atur header `Authorization: Bearer <CRON_SECRET>` menggunakan nilai yang sama dengan environment Vercel—jangan menaruh secret di URL.
   - **Panen RSS:** `POST https://<domain-aplikasi>/api/harvest`, setiap 4 jam.
   - **Publisher Buffer:** `GET https://<domain-aplikasi>/api/cron`, pada menit `00` dan `15` setiap jam.
4. Atur zona waktu UTC, aktifkan notifikasi kegagalan jika tersedia, lalu gunakan fungsi **Run now** untuk menguji masing-masing tugas. Panen hanya memasukkan berita ke antrean Neon. Publisher dapat mengirim satu artikel sungguhan ke antrean Buffer; Buffer menerbitkannya sesuai jadwal channel.

Jangan aktifkan pemicu otomatis lain yang memanggil endpoint yang sama. Publisher tetap menerapkan batas maksimal 2 pengiriman dalam 60 menit dan jeda minimum 15 menit. Post yang sudah masuk Buffer tidak diubah urutannya oleh antrean lokal.

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
