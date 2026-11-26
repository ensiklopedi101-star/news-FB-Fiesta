# News FB Fiesta v3.0 — Smart Content Manager & Multi-Free-AI

Backend Next.js untuk alur **RSS deterministik → AI Resilience Router (Groq → Gemini → Gemini cadangan → OpenRouter Free) → Smart Content Manager PopBeez → news card / roundup carousel 4 slide → Facebook Graph API / Buffer + cermin Instagram di latar belakang**. AI hanya menangani strategi dan editorial; panen feed/gambar tetap deterministik tanpa membakar token. Satu database **Neon Postgres** melalui `DATABASE_URL` melayani dua channel publikasi (`news` dan `entertainment`), memori konfigurasi/keputusan Content Manager, telemetri, serta pemantau error mandiri (`automation_logs`). Supabase tidak dibutuhkan.

> Repository tidak menyimpan kredensial. Hubungkan Neon lewat `DATABASE_URL`; daftar RSS dikelola dari Dashboard aplikasi dan disimpan di Neon. API AI dan Buffer diatur di Vercel Environment Variables.

## Yang sudah dibuat

- Dashboard admin untuk mengelola feed RSS langsung di aplikasi; tiap feed diarahkan ke channel `news` atau `entertainment` dan disimpan di tabel `rss_sources`.
- Preset satu-klik hiburan mencakup Soompi All News, Seoulbeats, dan MyDramaList News, sumber khusus C-Drama (DramaPanda C-News, Overseasidol), donghua (Yu Alexius, My Donghua Review), dan K-pop/idol (Soompi Music, Yonhap Culture/K-pop), beserta filter kata kunci per feed. Google News dan HanCinema tetap nonaktif untuk ditinjau terlebih dahulu.
- Panen RSS setiap 4 jam terpisah dari jadwal publikasi; artikel hasil panen masuk antrean Neon, bukan langsung diposting.
- Deduplicasi URL sumber dengan SHA-256 dan unique index di Neon; setiap artikel menyimpan `page_key` tujuan.
- Saat panen, sistem mencoba mengambil 1–2 paragraf artikel dan `og:image` dengan batas waktu, ukuran, HTTPS, dan redirect; jika gagal/diblokir, memakai cuplikan RSS.
- Ringkasan bahasa Indonesia melalui failover Groq → Gemini utama → Gemini cadangan. Caption memakai hook, fakta/konteks berbasis sumber, CTA netral, serta hashtag yang relevan.
- News card satu gambar atau eksperimen carousel empat slide pada `/api/og/{articleId}`; 50% artikel baru mendapat varian carousel secara stabil berdasarkan hash URL, 50% tetap satu gambar sebagai pembanding. Slide carousel memuat cover, dua fakta ringkas bersumber, dan pertanyaan komunitas. Dashboard menandai format aktual; performa jangkauan/engagement masih perlu dibandingkan manual melalui Facebook Insights hingga Meta API tersedia. Logo Nusabeez/PopBeez tertanam dari aset proyek.
- Deteksi gambar RSS mencakup enclosure, Media RSS (termasuk media:group), `content:encoded`, description/summary, gambar lazy-load, dan srcset; fallback halaman artikel memakai `og:image`, lalu latar fallback lokal.
- Dashboard menampilkan pratinjau aktual news card, indikator apakah foto sumber ditemukan, status token Blob, serta hasil panen berupa jumlah foto terdeteksi dan berhasil disimpan ke Blob.
- Halaman hiburan (PopBeez) menerbitkan langsung ke Facebook Graph API: caption bebas tautan, lalu tautan sumber/terjemahan dan tautan follow dikirim sebagai komentar pertama. Halaman berita memakai Buffer, dan tautan sumber di caption-nya memakai short link domain sendiri agar tidak terlihat seperti tautan luar yang panjang. Buffer pada paket tanpa fitur komentar pertama tetap menaruh tautan di caption.
- Endpoint cron yang dilindungi `CRON_SECRET`, endpoint health check, dan endpoint untuk memasukkan ulang artikel gagal.
- Penjadwalan panen RSS dan pemicu publisher dilakukan oleh cron-job.org melalui endpoint aplikasi yang dilindungi `CRON_SECRET`; tidak menggunakan GitHub Actions.
- Publisher otomatis mengikuti **4 slot jam WITA (UTC+8)**: **08:30 (pagi), 12:00 (siang), 15:30 (sore), 20:30 (malam)** — sama dengan 07:30, 11:00, 14:30, 19:30 WIB. Cron tetap dipanggil tiap 15 menit, tetapi artikel hanya dikirim dalam 14 menit setelah jam slot. Selain slot, `src/lib/schedule.ts` menegakkan **maksimal 4 post per hari, 1 post per jam, dan jeda minimal 210 menit** agar slot 08:30/12:00/15:30 dapat dipakai (`PUBLISH_MAX_PER_DAY`, `PUBLISH_MAX_PER_HOUR`, `PUBLISH_MIN_GAP_MINUTES`; semua punya batas aman saat diisi nilai aneh). Ini ritme editorial yang sedang diuji, bukan jaminan distribusi Meta. Post yang lolos review manual tidak dihitung ke kuota harian. Daftar jam bisa diganti lewat `PUBLISH_SLOTS_WITA` (atau `off` untuk mematikan batas slot) dan `PUBLISH_SLOT_GRACE_MINUTES`.
- **Roundup Feed PopBeez**: publisher Hiburan hanya mengirim carousel dengan **tepat 4 artikel bergambar yang layak**. Jika tersedia kurang dari 4, ia menunggu; jika lebih dari 4, memilih 4 dan sisanya tetap antre. Tidak ada post single atau carousel 3/5 gambar dari antrean Hiburan. Halaman Berita tetap memakai alur single-post terpisah. Setiap slide, ringkasan, judul, dan sumber memakai urutan artikel yang sama. Pilar konten (breaking, analysis, relatable, list, community, manga) hanya preferensi keragaman yang lunak—empat artikel dari pilar yang sama tetap boleh menjadi roundup. Feed tetap mengikuti empat slot WITA yang sudah ada.
- **Smart Content Manager Agent v3.0** (`src/lib/content-manager-core.ts`, `src/lib/content-manager.ts`): satu Konstitusi Redaksi PopBeez yang model-agnostik mencakup strategi pilar/riwayat, mood slot WITA, urutan Slide 1–4, koordinasi Writer/Reels, kurasi empat kandidat, deduplikasi lintas portal, Social SEO, anti-clickbait/brand, dan evaluasi klik shortlink + performa pilar 7 hari. Dashboard menyediakan arahan redaksi, fokus/larangan topik, pilihan voice, arsip duplikat, histori keputusan, dan simulasi baca-saja. Keputusan serta pengaturan disimpan sebagai shared memory di Neon; tabel auto-bootstrap dan fallback deterministik menjaga cron tetap jalan tanpa AI atau bila migrasi tertunda.
- **OpenRouter Free** menjadi provider terakhir dalam failover tanpa biaya: model katalog dibatasi ke `:free` atau `openrouter/free`, termasuk saat `OPENROUTER_MODEL` diisi. Vercel `v0` tidak dipakai sebagai provider editorial.
- **Reels otomatis dengan suara sendiri**: setiap artikel hiburan membawa **naskah narasi 25–35 detik** (hook → dua fakta → penilaian → pertanyaan) yang tidak ikut tampil di caption. Endpoint `/api/reels` menyuarakan naskah itu dengan **Edge TTS** (`id-ID-GadisNeural`, gratis dan tanpa API key sehingga kuota Gemini tetap untuk penulisan & kuis), menyusun frame 1080×1920 (satu kalimat per frame, brand dan sumber selalu terlihat), merender MP4 H.264/AAC dengan ffmpeg, lalu memposting lewat Reels API tiga fase. Maksimal satu Reel tiap `REELS_MIN_GAP_HOURS` (bawaan **24 jam**, jadi satu Reel per hari), dan artikel yang sudah punya Reel tayang dilewati. Frame Reels memakai palet PopBeez (pink `#f20b55` + kuning HIVECOMP), logo halaman yang benar-benar bulat di kiri atas, handle `@popbeez.hive` plus `facebook.com/portalbeez` di kaki frame, serta kredit **powered by HIVECOMP** di kanan bawah — sama seperti news card. Encoder tidak ikut dibundel ke Vercel: set `FFMPEG_PATH` bila host punya ffmpeg, atau jalankan `scripts/reels-render-worker.mjs` di VPS lalu set `REELS_RENDER_URL` + `REELS_WORKER_TOKEN`. Tanpa encoder, Reel ditandai `failed` dengan alasan jelas dan pipeline teks tidak terpengaruh.
- **Empat sudut pandang redaksi** (`src/lib/editorial-voices.ts`): *Kritis*, *Santai*, *Industri*, dan *Penonton*. Setiap artikel ditulis dalam satu kolom yang dipilih deterministik dari id artikel, sehingga label caption menjadi “💡 Sudut pandang PopBeez · Kritis” dan nada antar post tidak lagi seragam seperti templat.
- **Bahasa & brand**: brand hiburan selalu ditulis **PopBeez** (B kapital) di caption, kartu, kuis, Reels, dan dashboard; pembaca disapa **Beezers**. Copy memakai bahasa ngobrol: partikel *sih/deh/nih/banget*, slang ringan (*gak*, *udah*, *bikin*, *acungi jempol*), dan 1–3 emoji. Panduan lengkapnya ada di `VOICE_STYLE_GUIDE` (`src/lib/editorial-voices.ts`) dan ikut masuk ke prompt, termasuk daftar frasa terlarang (“dalam dunia hiburan”, “tak dapat dipungkiri”, dst). Label section seperti “Sudut pandang PopBeez · Santai:” **tidak** pernah ditulis lagi — opini langsung menyambung paragraf sebelumnya. Nama nada (Kritis/Santai/Industri/Penonton) hanya tampil sebagai metadata di dashboard.
- **Penjaga orisinalitas (anti “Limited Originality of Content”)**: setiap caption wajib membawa nilai tambah, bukan ringkasan sumber. Prompt AI menuntut dua paragraf hasil parafrase, satu paragraf opini bernada ngobrol (sebab-akibat, perbandingan, atau penilaian) **tanpa label section**, dan satu pertanyaan diskusi yang menyapa *Beezers*. Sebelum dikirim, `src/lib/originality.ts` menilai caption secara deterministik (0–100) memakai kemiripan shingle 6 kata, panjang salinan verbatim, dan keberadaan sinyal opini/analisis/pertanyaan. Opini wajib dibuka dengan penyebutan brand (“Menurut PopBeez sih…”, “PopBeez rasa…”), dan pertanyaan diskusi otomatis disapa *Beezers* bila model lupa. Caption dengan **8 kata berurutan** yang sama dengan sumber atau skor di bawah `ORIGINALITY_MIN_SCORE` (bawaan **45**) **otomatis ditulis ulang sekali** dengan brief lebih ketat dan catatan penilai (tanpa perlu menekan tombol); bila draft kedua tetap gagal barulah statusnya `failed` dengan alasan tertulis dan post tidak pernah tayang. Jumlah draft dibatasi `ORIGINALITY_MAX_ATTEMPTS` (bawaan **2**, rentang 1–2) karena setiap draft memakan satu panggilan AI: `/api/cron` kini berjalan dengan `maxDuration = 120` detik agar dua draft (masing-masing beranggaran 30 detik) dan proses publish tetap muat. Skor, alasan, dan blok opini disimpan di kolom `articles.originality_score`, `articles.originality_notes`, dan `articles.editorial_take`, lalu diringkas di panel **Penjaga orisinalitas** pada dashboard.
- Kuis **Tebak Drama** untuk menambah interaksi: grid 2×3 dengan lima poster acak dari review manual PopBeez, sel pojok kanan bawah berisi logo PopBeez dan tulisan “Tebak Drama”. Tiap poster diubah dulu menjadi **siluet 2D** (tanpa mata/hidung/mulut, tanpa judul) memakai model gambar Gemini, lalu disusun otomatis dengan `sharp` dan diposting ke halaman hiburan beserta caption bebas tautan (tanpa kunci jawaban). Jadwal bawaannya Minggu 19:15 WITA setiap 14 hari; tombol **Buat & posting kuis sekarang** di dashboard melewati jadwal. Satu poster paling banyak muncul di tiga edisi, lalu poster itu dipensiunkan otomatis. Bila model gambar tidak tersedia (`QUIZ_SILHOUETTE_AI=0` atau API gagal), tile tetap dibuat oleh mesin siluet lokal berbasis `sharp`.

Setiap siklus panen memproses maksimal 50 kandidat berita ke antrean `queued` di Neon; deduplikasi URL mencegah artikel yang sama masuk dua kali. Saat panen, sistem mencoba mengambil maksimal dua paragraf isi artikel (maks. 1.500 karakter) dan foto `og:image`; jika gagal atau diblokir, sistem tetap memakai teks/gambar RSS. Publisher mengirim maksimal satu artikel per siklus, tidak mengambil feed saat proses rilis, dan menerapkan batas maksimal **1 pengiriman dalam 60 menit**, jeda minimum **210 menit**, dan plafon **4 post per hari** untuk publikasi otomatis. Selain itu publisher otomatis hanya jalan di dalam jendela slot WITA (lihat poin jadwal di atas); di luar jendela, `/api/cron` menjawab `outside-slot` tanpa menyentuh antrean. Dengan antrean penuh sekalipun, publisher otomatis tidak bisa melewati 4 post per hari; Buffer sendiri menerbitkannya sesuai slot jadwal channel. Pastikan feed menyediakan konten yang cukup dan atur jadwal Buffer sesuai volume yang diinginkan. Feed yang gagal dicatat di dashboard. Hanya berita yang berumur maksimal 7 jam sejak waktu terbit sumber yang dipertahankan; berita lebih lama otomatis dikeluarkan dari antrean. Jika feed RSS tidak menyediakan waktu terbit, umur dihitung sejak berita masuk ke sistem. Dashboard memisahkan daftar artikel menjadi dua bagian agar tidak tercampur: **Belum terbit** (hanya antrean lokal bernomor yang masih menunggu dikirim) dan **Sudah terbit** (maksimal 20 baris terakhir: artikel `processing` yang sedang dikirim, `ready` yang sudah diterima Buffer dan menunggu slot jadwal, `published` yang sudah tayang, dan `failed` yang perlu dicoba ulang — lengkap dengan waktu kirim/terbit dan tautan post Facebook bila tersedia). Berita yang masih berstatus antre bisa diberi prioritas atau dikeluarkan secara manual dari bagian **Belum terbit**.

### Worker render Reels (opsional, untuk VPS)

Vercel tidak menyertakan ffmpeg. Kalau ingin Reels dirender di VPS sendiri:

```bash
# di VPS (butuh node 20+ dan ffmpeg di PATH)
WORKER_TOKEN=ganti-token-kuat PORT=8080 node scripts/reels-render-worker.mjs
```

Lalu di Vercel set `REELS_RENDER_URL=https://vps-kamu:8080`, `REELS_WORKER_TOKEN=ganti-token-kuat`, dan `BLOB_READ_WRITE_TOKEN` (frame diunggah ke Blob agar bisa diunduh worker). Worker hanya menerima `POST /render` dengan header `Authorization: Bearer $WORKER_TOKEN`, mengunduh frame, menyatukannya dengan audio MP3 menjadi MP4 H.264/AAC 1080×1920, lalu mengembalikan file videonya. Cek kesehatan dengan `GET /health`.

## 1. Siapkan database Neon (kamu yang memasang)

1. Buat database PostgreSQL di Neon atau melalui Vercel Marketplace.
2. Ambil **pooled connection string** Neon (`postgresql://...`, SSL aktif).
3. Jika tabel `articles` belum ada, buat skema awal dengan salah satu cara berikut:
   - Jalankan `npm install`, isi `DATABASE_URL` di `.env.local`, lalu jalankan `npm run db:push`; atau
   - Buka Neon SQL Editor dan jalankan isi file [`drizzle/schema.sql`](./drizzle/schema.sql).
4. Jika tabel `articles` sudah ada dari skema versi sebelumnya, jalankan sekali file [`drizzle/0001_multi_page.sql`](./drizzle/0001_multi_page.sql) di Neon SQL Editor. Kolom baru `page_key` untuk artikel lama otomatis bernilai `news`.
5. Jalankan file [`drizzle/0002_rss_sources.sql`](./drizzle/0002_rss_sources.sql) untuk membuat tabel feed RSS yang dikelola dari Dashboard. Jika database belum memiliki tabel `articles`, gunakan `drizzle/schema.sql` yang sudah mencakup kedua tabel.
6. Jalankan [`drizzle/0003_scheduled_harvest.sql`](./drizzle/0003_scheduled_harvest.sql) untuk menambahkan filter kata kunci dan pengunci publisher.
7. Untuk database yang sudah ada, jalankan [`drizzle/0004_hivecomp_posts_index.sql`](./drizzle/0004_hivecomp_posts_index.sql) sekali saat deploy untuk indeks feed publik terbaru. Instalasi baru dengan `drizzle/schema.sql` sudah mencakupnya. Endpoint API tidak menjalankan migrasi.
8. Pastikan `DATABASE_URL` yang sama tersedia di Vercel Production; Preview juga perlu jika kamu akan mengetes preview deployments.

Jangan kirim connection string ke chat atau commit ke Git.

## 2. Siapkan environment variables

Salin `.env.example` ke `.env.local` untuk pengujian lokal. Tambahkan variabel yang sama di **Vercel → Project → Settings → Environment Variables** untuk deployment.

- `DATABASE_URL`: connection string pooled Neon.
- `CRON_SECRET`: nilai acak panjang, minimal 32 karakter. Lindungi seperti password.
- `HIVECOMP_API_TOKEN`: secret terpisah untuk API read-only landing HiveComp, minimal 32 karakter acak. Hanya dipasang di server backend dan server landing; tidak memakai prefix `NEXT_PUBLIC_`. Lihat [panduan HiveComp](./docs/hivecomp-api.md).
- `GROQ_API_KEY`: opsional, penyedia AI pertama yang dicoba.
- `GROQ_MODEL`: opsional, preferensi model Groq. Aplikasi memeriksa katalog model akun secara otomatis, mengutamakan model ekonomis seperti `llama-3.1-8b-instant`, dan beralih jika model tidak tersedia.
- `GEMINI_API_KEY`: key Gemini utama, dicoba jika Groq gagal.
- `GEMINI_API_KEY_FALLBACK`: key Gemini cadangan, dicoba jika key Gemini utama gagal.
- `GEMINI_MODEL`: opsional, preferensi model Gemini. Aplikasi hanya memakai model yang terdaftar dan mendukung `generateContent`, lalu mencoba kandidat Flash/Flash-Lite yang hemat.
- `OPENROUTER_API_KEY`: opsional, cadangan terakhir OpenRouter. Daftar model selalu dibatasi ke model gratis `:free` atau `openrouter/free`.
- `OPENROUTER_MODEL`: opsional, preferensi model OpenRouter; model berbayar ditolak meskipun variabel ini diisi.

News FB Fiesta v3.0 memakai **AI Resilience Router** (`src/lib/ai.ts`, `src/lib/ai-draft.ts`) dengan urutan Groq → Gemini utama → Gemini cadangan → OpenRouter Free. JSON draft dan keputusan editorial sama-sama divalidasi sebelum dipakai; model OpenRouter yang menerima `response_format` terbatas dicoba ulang tanpa opsi tersebut. Panen RSS, pemilihan gambar, dan deteksi duplikat URL tetap deterministik agar tidak memakai token AI. Untuk roundup Hiburan, Smart Content Manager mendapat konteks editorial yang sama di tiap provider; jika seluruh provider gagal, rule-based curator memilih empat berita dan pipeline tetap berjalan.
- `BUFFER_API_KEY`: API key Buffer (Bearer token), simpan hanya sebagai environment variable Vercel.
- `BUFFER_NEWS_CHANNEL_ID`: ID channel Facebook Page berita yang sudah terhubung ke Buffer.
- `BUFFER_ENTERTAINMENT_CHANNEL_ID`: ID channel Facebook Page hiburan yang sudah terhubung ke Buffer.
- `APP_URL`: URL HTTPS deployment publik tanpa slash di akhir. Buffer/Facebook mengambil news card dan short link dari URL ini.
- `SHORTLINK_BASE_URL`: opsional, domain pendek sendiri (HTTPS) yang diarahkan ke project Vercel yang sama, misalnya `https://pop.beez.id`. Jika kosong, short link memakai `APP_URL`.
- `BLOB_READ_WRITE_TOKEN`: token akses Vercel Blob. Buat Blob Store pada project Vercel; Vercel akan memasang token ini sebagai environment variable. Proses panen menyimpan gambar artikel baru ke Blob dan memperbarui `articles.image_url` di Neon. Endpoint OG menormalkan gambar ke JPEG sebelum `ImageResponse` merendernya. Tidak ada migrasi schema.
- `PAGE_BRAND_NEWS`, `PAGE_BRAND_ENTERTAINMENT`: nama yang dicetak pada kartu masing-masing Page.
- Logo default tersedia di `public/brand/nusabeez_icon.png` dan `public/brand/popbeez_icon.png`; URL custom per Page bisa diatur lewat `PAGE_LOGO_NEWS_URL` atau `PAGE_LOGO_ENTERTAINMENT_URL`, dengan `PAGE_LOGO_URL` sebagai fallback bersama.
- `FB_ENTERTAINMENT_PAGE_ID` + `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN`: mengaktifkan publikasi langsung halaman hiburan (PopBeez) ke Facebook Graph API, termasuk review manual, tanpa Buffer. Token harus Page Access Token berumur panjang dengan izin `pages_manage_posts`. Halaman berita tetap memakai Buffer; `FB_NEWS_PAGE_ID`/`FB_NEWS_PAGE_ACCESS_TOKEN` hanya dipakai untuk retry komentar sumber.
- `FB_GRAPH_VERSION`: versi Graph untuk publish/komentar, opsional dan default `v23.0`.
- `FB_INSIGHTS_GRAPH_VERSION`: versi Graph khusus Insights, default `v25.0` (minimum v25, karena metrik impresi/jangkauan lama sudah diganti Meta dengan media views/unique viewers). Versi Insights tidak mengubah endpoint publishing.
- Facebook Insights memakai Page ID dan token server-side di atas, dengan izin `read_insights` + `pages_read_engagement` dan tugas **Analyze** pada Page. Jangan kirim token ke browser atau chat. Pada cron terjadwal, pengambilan snapshot dijadwalkan setelah respons dan hanya di luar slot WITA agar tidak bersaing dengan publikasi; tombol dashboard/`POST /api/admin/facebook-insights` bisa memicu sinkronisasi baca-saja. Koleksi hanya mengambil post langsung yang terbit 30 hari terakhir; tiap nilai adalah metrik lifetime saat terakhir disinkronkan, bukan angka harian. Jika metrik komentar/bagikan tidak bisa dibaca, view/reaction yang tersedia tetap tersimpan dan kurasi menandai sampel interaksi sebagai parsial.
- `PUBLISH_MAX_PER_DAY` (bawaan **4**), `PUBLISH_MAX_PER_HOUR` (bawaan **1**), `PUBLISH_MIN_GAP_MINUTES` (bawaan **210**): cadence publisher otomatis. Nilai dinormalkan ke rentang aman (1–24 post/hari, 1–12 post/jam, 0–1440 menit) supaya salah isi tidak mematikan atau membanjiri halaman.
- `PUBLISH_SLOTS_WITA` (bawaan **08:30,12:00,15:30,20:30** WITA) dan `PUBLISH_SLOT_GRACE_MINUTES` (bawaan **14**): jam tayang pagi–siang–sore–malam.
- `REELS_ENABLED`, `REELS_TTS_VOICE`, `REELS_MIN_GAP_HOURS` (bawaan **24** = satu Reel per hari), `FFMPEG_PATH`, `REELS_RENDER_URL` + `REELS_WORKER_TOKEN`: pipeline Reels.

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

### Publikasi langsung Facebook untuk PopBeez (opsional)

Jika `FB_ENTERTAINMENT_PAGE_ID` dan `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN` diisi, halaman hiburan menerbitkan langsung ke Facebook Graph API:

1. Satu gambar dikirim ke `POST /{page-id}/photos` dengan `published=true`.
2. Carousel diunggah sebagai beberapa foto `published=false`, lalu digabung lewat `POST /{page-id}/feed` dengan field `attached_media[0..n]`.
3. Status artikel langsung menjadi `published` dan ID posting Facebook disimpan di `facebook_post_id`.
4. Review manual PopBeez (enam slide) ikut memakai jalur langsung dan tidak dibatasi kuota Buffer.

Halaman berita tetap memakai Buffer. Jika dua variabel hiburan itu kosong, halaman hiburan otomatis kembali ke Buffer sehingga aplikasi tetap berjalan. Token dan Page ID hanya disimpan sebagai environment variable Vercel, bukan di Neon atau repositori.

### Instagram: setiap post Facebook ikut tayang di @popbeez.hive

Posting tidak lagi hanya ke Facebook. Setelah sebuah post sukses terbit di halaman Facebook PopBeez, pipeline langsung mencerminkan post yang sama ke Instagram:

1. **Feed & carousel** — `publishInstagramPost()` membuat container `image_url` (satu gambar) atau carousel `is_carousel_item` lalu `CAROUSEL`, memakai kartu `api/og/<id>` yang sama seperti Facebook, dan menerbitkannya lewat `media_publish`. Caption yang dipakai persis caption Facebook.
2. **Kuis Tebak Drama** — gambar kuis di Blob dicerminkan sebagai satu post foto.
3. **Review manual PopBeez** — keenam slide dicerminkan sebagai carousel Instagram.
4. **Reels** — `publishInstagramReel()` memakai `media_type=REELS`, menunggu `status_code=FINISHED`, lalu menerbitkan. Ini butuh video publik, jadi `BLOB_READ_WRITE_TOKEN` wajib aktif.
5. Kegagalan Instagram **tidak pernah** membatalkan post Facebook: status artikel tetap `published`, pesan kesalahan disimpan di `error_message`, dan ID media IG dicatat di `instagram_media_id`.

Isi `IG_USER_ID` (ID akun Instagram Business, bukan username) dan `IG_ACCESS_TOKEN` di Vercel → Settings → Environment Variables, lalu deploy ulang. Token halaman Facebook hiburan boleh dipakai sebagai `IG_ACCESS_TOKEN` selama akun IG sudah tertaut ke halaman itu. Status kesiapan terlihat di panel **Panduan setup API** pada dashboard (`Instagram @popbeez.hive`).

### Landing page: cara post backend muncul otomatis

Tidak ada langkah manual per post: cron-job.org sudah memicu `/api/cron` (menit `00` dan `15`), artikel terbit ke Facebook + Instagram, lalu langsung tersedia di feed publik:

```
GET https://<APP_URL>/api/public/posts?page=entertainment&limit=12
GET https://<APP_URL>/api/public/posts?page=news&limit=12
```

Respons berisi `title`, `excerpt`, `image` (kartu 1080×1080 siap pakai), `images` (semua slide carousel), `facebookUrl`, `instagramUrl`, `shortUrl`, `sourceName`, dan `publishedAt`; CORS terbuka (`*`) sehingga boleh dipanggil dari domain landing page mana pun. Landing page cukup merender JSON itu dan memanggil ulang tiap 60 detik:

```js
async function loadPosts() {
  const res = await fetch("https://<APP_URL>/api/public/posts?page=entertainment&limit=12", { cache: "no-store" });
  const { posts } = await res.json();
  render(posts); // satu kartu per post, tautkan ke facebookUrl/shortUrl
}
loadPosts();
setInterval(loadPosts, 60_000);
```

Hanya artikel `published` yang tampil; artikel `buffer:pending:%`/`facebook:pending:%` (belum pasti tayang), review manual, dan gambar aggregator seperti rss.app difilter. Cache edge 60 detik, jadi post baru muncul paling lambat sekitar satu menit setelah terbit.

### Short link domain sendiri

Aplikasi menyimpan short link di tabel `short_links` (Neon) dan mengarahkannya lewat route `/s/<slug>`:

1. Tambahkan domain pendek ke project Vercel yang sama, lalu set `SHORTLINK_BASE_URL` ke domain itu.
2. Jalankan migrasi `drizzle/0009_short_links.sql`.
3. Setiap tautan sumber yang dipakai untuk caption/komentar otomatis dibuatkan slug deterministik, sehingga URL yang sama memakai short link dan penghitung klik yang sama.
4. Jumlah klik tersimpan di kolom `clicks` dan `last_clicked_at` pada `short_links`; bisa dibaca langsung dari Neon.
5. `popbeez.hivecomp.my.id` hanya melayani `/s/<slug>`; path lain di domain itu mengembalikan 404. Aplikasi/dashboard tetap di `portal-beez.vercel.app`. Batas ini diatur middleware dan bisa dipindah/dimatikan lewat `SHORTLINK_ONLY_HOST` (isi `off` untuk mematikan), misalnya saat subdomain itu dipakai sebagai frontend bisnis.

Jika tabel atau domain belum siap, aplikasi otomatis memakai URL asli sehingga publikasi tidak gagal.

Aplikasi membuat post dengan mode **Add to Queue**. Pastikan channel Facebook Page Buffer diatur untuk auto-publishing, bukan notifikasi manual, jika ingin publikasi otomatis. Batas/rencana API dan ketersediaannya mengikuti akun Buffer. Tidak perlu membuat Meta App/Page Access Token untuk alur posting lewat Buffer. Daftar RSS tetap dikelola di dashboard aplikasi dan disimpan di Neon; feed Google News/HanCinema yang dipreset nonaktif harus ditinjau dulu.

Satu database Neon menyimpan semua artikel beserta `page_key`; tidak perlu membuat database kedua. API key Buffer dan channel ID disimpan di Vercel, bukan di Neon.

## 3. Deploy dan aktifkan cron-job.org

1. Push branch/repository ke GitHub dan hubungkan project ke Vercel sebagai Next.js.
2. Tambahkan environment variables di Vercel dan deploy. `APP_URL` harus sama dengan URL deployment publik; `CRON_SECRET` harus terisi dan dirahasiakan.
3. Di [cron-job.org](https://cron-job.org/), buat dua tugas HTTPS. Untuk keduanya, atur header `Authorization: Bearer <CRON_SECRET>` menggunakan nilai yang sama dengan environment Vercel—jangan menaruh secret di URL.
   - **Panen RSS:** `GET` atau `POST https://<domain-aplikasi>/api/harvest`, setiap 2–4 jam (dibatasi ~22 detik agar aman dari timeout 30 detik `cron-job.org`).
   - **Publisher:** `GET` atau `POST https://<domain-aplikasi>/api/cron`, pada menit `00` dan `15` setiap jam. Di luar jam slot responsnya `outside-slot` (dan otomatis memicu panen RSS cadangan bila feed belum diambil >= 4 jam atau kandidat gambar Hiburan < 4). Aplikasi yang menghitung WITA, jadi zona waktu cron-job.org tetap UTC. Jangan mengarahkan cron ke domain `SHORTLINK_ONLY_HOST` (`popbeez.hivecomp.my.id`) karena semua jalur selain `/s/*` diblokir 404.
   - **Kuis Tebak Drama:** `GET https://<domain-aplikasi>/api/quiz`, sekali sehari pada menit `15` jam `11` UTC (= 19:15 WITA). Endpoint hanya memposting bila hari itu Minggu dan sudah 14 hari sejak edisi terakhir; respons lain adalah `not-due` dan itu normal.
4. Atur zona waktu UTC, aktifkan notifikasi kegagalan jika tersedia, lalu gunakan fungsi **Run now** untuk menguji masing-masing tugas. Panen hanya memasukkan berita ke antrean Neon. Publisher dapat mengirim satu artikel sungguhan ke antrean Buffer; Buffer menerbitkannya sesuai jadwal channel.

Jangan aktifkan pemicu otomatis lain yang memanggil endpoint yang sama. Publisher tetap menerapkan batas maksimal 2 pengiriman dalam 60 menit dan jeda minimum 15 menit. Post yang sudah masuk Buffer tidak diubah urutannya oleh antrean lokal.

## Dashboard: tab per bagian

Dashboard tidak lagi satu halaman panjang. Setiap bagian punya tab sendiri, dan tab terakhir yang dibuka diingat browser (localStorage), jadi refresh tidak melempar kamu ke atas:

| Tab | Isi |
| --- | --- |
| Ringkasan | Statistik artikel, peringatan kesehatan otomasi, pemeriksaan layanan, jendela slot tayang |
| Diagnostik & Error | Detak `/api/cron` & panen RSS terakhir, diagnosis kemacetan otomatis, daftar feed/artikel gagal, pemulihan massal artikel gagal, dan ekspor laporan JSON |
| Antrean | Artikel yang belum dikirim + tombol **Panen RSS sekarang** dan **Terbitkan** |
| Sudah terbit | Post yang sudah keluar dari antrean (terbit, menunggu slot Buffer, gagal) |
| Content Manager | Arahan redaksi, performa 7 hari, simulasi kurasi, dan memori keputusan |
| Feed RSS | Daftar sumber, form tambah feed, preset hiburan |
| Konten manual | Form review mingguan enam slide |
| Kuis | Tebak Drama: pratinjau edisi terakhir + tombol buat sekarang |
| Reels | Reel terakhir, daftar sudut pandang, tombol render sekarang |
| Orisinalitas | Skor, ambang lulus, dan post yang ditahan |
| Setup API | Daftar environment variable, tes AI, tes Buffer, status OpenRouter Free & Instagram |

Badge angka di tab Antrean / Sudah terbit / Feed RSS menunjukkan jumlah item, dan badge merah di **Sudah terbit** menandai artikel gagal. Tombol **Mirror ke Instagram** muncul di baris artikel terbit yang belum punya post Instagram.

## Dashboard dan endpoint

Dashboard di `/` meminta `CRON_SECRET` sebelum menampilkan data. Di dalamnya kamu dapat mengimpor preset hiburan, mengatur strategi Content Manager, melihat Facebook Insights 30 hari dan klik shortlink 7 hari secara terpisah, menjalankan simulasi kurasi baca-saja, menambah feed, melihat antrean, menjalankan panen manual (tidak menerbitkan), membaca channel Buffer secara read-only, dan menguji failover AI. Simulasi menyimpan jejak editorial di Neon tetapi tidak mengubah status artikel atau memublikasikan. Dashboard menampilkan ID model konfigurasi dan status percobaan AI; keberadaan key saja tidak berarti key/model valid. API key disimpan di Vercel Environment Variables—dashboard tidak meminta atau menyimpan API key. Tombol kirim manual hanya muncul saat konfigurasi siap; tombol itu mengirim post ke antrean Buffer, dan Buffer dapat menerbitkannya otomatis mengikuti jadwal channel.

- `GET /api/dashboard` — ringkasan admin, performa Content Manager, keputusan terbaru, dan status integrasi (wajib bearer secret).
- `GET/PUT/POST /api/admin/content-manager` — baca pengaturan/analitik/keputusan; simpan arahan, pilar fokus, kata hindari, voice, dan deduplikasi; atau jalankan simulasi kurasi editorial antrean Hiburan (wajib bearer secret). Simulasi tidak mengubah artikel atau menerbitkan.
- `POST /api/admin/facebook-insights` — sinkronisasi baca-saja metrik post Facebook untuk 30 hari terakhir; body `{ "force": true }` mengabaikan cache 24 jam. Wajib bearer secret.
- `POST/PATCH/DELETE /api/admin/feeds` — kelola RSS dari dashboard (wajib bearer secret).
- `POST /api/admin/feeds/import-presets` — masukkan preset hiburan (wajib bearer secret).
- `GET /api/admin/buffer/channels` — baca nama dan ID channel Buffer (wajib bearer secret; tidak membuat post).
- `POST /api/admin/diagnostics/ai` — uji satu kali pembuatan teks melalui failover AI dengan prompt sintetis; memakai kuota provider, tidak menyimpan hasil, dan tidak mengirim ke Buffer (wajib bearer secret).
- `POST /api/harvest` — ambil RSS dan isi antrean tanpa publikasi (wajib bearer secret).
- `GET /api/health` — pemeriksaan read-only koneksi/skema database dan status konfigurasi integrasi (boolean saja, bukan kredensial). Tidak memperbaiki atau menulis data; skema belum siap menghasilkan 503 JSON.
- `GET /api/pages/{brand}/posts` — feed read-only HiveComp untuk `popbeez` (`entertainment`) atau `nusabeez` (`news`), wajib Bearer `HIVECOMP_API_TOKEN`. Maksimal 3 artikel dengan referensi Facebook dan waktu publikasi yang tersimpan, terbaru dahulu; antrean Buffer tidak dianggap terbit. `items` selalu array, cache sukses 5 menit. [Kontrak, env, curl, contoh error, keterbatasan data, dan panduan deploy](./docs/hivecomp-api.md).
- `GET /api/cron` — proses satu artikel dan kirim ke antrean Buffer; mematuhi batas 2 pengiriman/jam dan jeda 15 menit. Wajib header `Authorization: Bearer <CRON_SECRET>`. Buffer mengatur waktu publikasi akhir.
- `POST /api/admin/retry` — memasukkan kembali artikel berstatus `failed` ke antrean. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `POST /api/admin/retry-comment` — mengulang komentar sumber untuk postingan yang sudah terbit. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`.
- `GET/POST /api/admin/diagnostics/system` — baca laporan kesehatan otomasi, detak cron/harvest, daftar feed/artikel gagal, serta jalankan opsional `{ "runHarvest": true, "probeAi": true }` dari satu endpoint (wajib bearer secret).
- `GET/POST /api/harvest` — ambil RSS dan isi antrean tanpa publikasi (wajib bearer secret).
- `GET /api/health` — tes koneksi database dan melihat status integrasi (hanya status ada/tidak, bukan rahasia).
- `POST /api/admin/instagram-mirror` — cerminkan **post yang sudah terbit di Facebook** ke Instagram tanpa memposting ulang ke Facebook. Body `{ "id": "<uuid>" }` untuk satu artikel (atau `?id=` lewat GET), `{ "limit": 3 }` untuk beberapa post terbaru yang belum punya ID Instagram, `{ "reelId": "<uuid>" }` untuk satu Reel, dan `"force": true` untuk memaksa post yang sudah pernah dicerminkan. Wajib `Authorization: Bearer <CRON_SECRET>`.
- `GET /api/cron/blob-cleanup?dryRun=1` — bersih-bersih kuota Vercel Blob (frame Reel, video lama, gambar kuis, foto artikel). Wajib `Authorization: Bearer <CRON_SECRET>`; `dryRun=1` hanya melaporkan.
- `GET /api/public/posts?page=entertainment|news&limit=12` — feed publik (CORS terbuka) berisi post yang sudah terbit di Facebook/Instagram. Dipakai landing page; tidak perlu autentikasi.
- `GET /api/cron` — proses satu edisi roundup Hiburan atau satu artikel Berita: terbit langsung ke Facebook (PopBeez) atau masuk antrean Buffer (berita). Otomatis hanya berjalan pada slot WITA dan mematuhi kuota harian/per-jam serta jeda minimum di konfigurasi publisher. Tambahkan `?force=1` untuk melewati jadwal slot (dipakai tombol **Terbitkan** manual). Wajib header `Authorization: Bearer <CRON_SECRET>`. Content Manager hanya mengatur editorial; panen RSS tetap deterministik.
- `GET /api/reels` — membuat satu Reel dari artikel hiburan terbaru bila `REELS_ENABLED=1` dan jeda `REELS_MIN_GAP_HOURS` sudah lewat. `POST /api/reels` memaksa satu Reel sekarang (dipakai tombol dashboard, melewati flag & jeda). Wajib header `Authorization: Bearer <CRON_SECRET>`. Butuh encoder: `FFMPEG_PATH` atau `REELS_RENDER_URL`.
- `GET /api/quiz` — membuat dan memposting kuis Tebak Drama (cron harian). `POST /api/quiz` memaksa satu edisi sekarang (dipakai tombol dashboard). Wajib header `Authorization: Bearer <CRON_SECRET>`. Poster diambil dari `raw_text` review manual, dipilih acak, diubah menjadi siluet oleh `GEMINI_IMAGE_MODEL` (default `gemini-2.5-flash-image`, bisa dimatikan dengan `QUIZ_SILHOUETTE_AI=0`), dan setiap poster berhenti dipakai setelah muncul di tiga edisi.
- `POST /api/admin/retry` — memasukkan kembali artikel berstatus `failed` ke antrean. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}` untuk satu artikel atau `{"bulk":true}` untuk memulihkan seluruh artikel gagal yang belum kedaluwarsa.
- `POST /api/admin/retry-comment` — mengulang komentar sumber untuk postingan yang sudah terbit. Wajib header bearer yang sama dan JSON `{"id":"<uuid artikel>"}`. Komentar dikirim ke `POST /<graph-version>/<post-id>/comments`; id postingan dari Facebook sudah memuat ID halaman, jadi ID halaman tidak boleh ditambahkan lagi (kalau ditambahkan, Graph menjawab `Unknown path components`). Dashboard menampilkan tombol **Kirim ulang komentar sumber** pada post yang komentarnya gagal.
- `GET /api/og/{articleId}` — gambar news card untuk artikel tersimpan.

Contoh uji manual:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron"
```

Jangan memanggil endpoint cron berulang-ulang untuk tes di production: setiap artikel berhasil akan ditambahkan ke antrean Buffer dan dapat diterbitkan otomatis oleh Buffer.

## Tampilan kartu: kredit HIVECOMP, logo bulat, ajakan Instagram

- Sudut kanan bawah setiap kartu (news card, carousel, review manual, edisi kuis) kini berbunyi **powered by HIVECOMP**: kata `powered by` kecil dan tipis, lalu `HIVE` putih + `COMP` kuning (`#ffd12e`). Konstanta ada di `src/lib/brand.ts` (`POWERED_BY`, `poweredByLine()`).
- Logo halaman selalu digambar **bulat**: `src/lib/og-card.ts` dan `src/lib/quiz-card.ts` memotong logo dengan mask lingkaran + cincin tipis. Mengganti `public/brand/popbeez_icon.png` dengan berkas persegi tidak lagi menghasilkan kotak putih.
- Slide CTA carousel (`slide=4`) menampilkan ikon Facebook **dan** Instagram dengan handle `portalbeez` + `@popbeez.hive`; caption kuis, Reels, dan komentar sumber juga menyebut Instagram.
- Frame Reels ikut aturan yang sama: logo bulat di kiri atas, palet pink `#f20b55` + kuning `#ffd12e`, `@popbeez.hive` sebagai handle utama dengan `facebook.com/portalbeez` sebagai baris kedua, dan **powered by HIVECOMP** di kanan bawah.
- Gambar dari layanan aggregator seperti **rss.app** diblokir total (`isKnownAggregatorBrandImage()`), bukan hanya berkas logonya, dan route kartu memeriksa ulang gambar yang sudah tersimpan sehingga feed lama pun tidak bisa memunculkan placeholder itu lagi.

## Instagram: "Media ID is not available" dan cara mendiagnosisnya

Error `Instagram Graph API: Media ID is not available` berarti Meta sudah membuat *container* media tetapi **belum selesai memprosesnya**, lalu kita memanggil `media_publish` terlalu cepat (kode 9007). Sejak perbaikan ini:

1. Setiap container — foto tunggal, **setiap child carousel**, container carousel induk, dan Reel — dipoll lewat `?fields=status_code` sampai `FINISHED` (maks. 45 detik; Reel 60 detik) sebelum `media_publish`.
2. Kalau Meta tetap menjawab 9007, publish dicoba ulang sampai 4 kali dengan jeda 4 → 8 → 12 detik, dan container diperiksa ulang di antara percobaan.
3. Pesan error sekarang menyertakan kode/subkode Graph plus petunjuk: 9007 = media belum siap, 190 = token kedaluwarsa, 200/10 = izin kurang, 4/17/32 = kena rate limit, 100 = `IG_USER_ID` salah, 24 = URL gambar tidak bisa diunduh Meta.

### Cek kesehatan Instagram tanpa memposting apa pun

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/admin/instagram-check"
```

Endpoint ini (hanya GET) memeriksa: kredensial, akun di balik `IG_USER_ID` (username, jumlah media, follower), **apakah halaman Facebook benar-benar tertaut ke akun IG itu**, dan sisa kuota `instagram_content_publish` per 24 jam. Kalau `IG_USER_ID` bukan ID akun yang tertaut ke halaman, hasilnya akan menyebutkan ID yang benar.

Nilai yang dipakai PopBeez sekarang: `IG_USER_ID=17841480354041840` (`@popbeez.hive`), `IG_USERNAME=@popbeez.hive`, halaman Facebook `FB_PAGE_ID=1468363823021623`. Nama env `FB_PAGE_ID` dan `FB_PAGE_ACCESS_TOKEN` diterima sebagai alias.

Pastikan juga: aplikasi Meta memakai izin `instagram_basic` + `instagram_content_publish` (+ `pages_show_list`, `pages_read_engagement`), akun IG berstatus **Business/Creator**, dan URL gambar kartu (`/api/og/<id>`) bisa diakses publik sebagai JPEG — keduanya sudah dipenuhi pipeline ini.

## Kuota Vercel: Functions Storage dan Blob itu per akun, bukan per project

Kuota Vercel dihitung **per team/akun**. Tiga project di akun yang sama berbagi satu jatah: Functions Storage (10 GB di Hobby, isinya salinan fungsi dari **setiap deployment yang masih disimpan**) dan Blob (1 GB). Jadi project yang tidak dipakai tetap memakan jatah selama deployment lamanya masih ada.

### Yang bisa dilakukan di dashboard (tanpa deploy)

1. **Settings → Deployment Retention** di tiap project: pakai `Keep 3` dan `Expire 3 days` untuk production maupun preview. Salinan fungsi dari deployment lama langsung dibuang, dan fungsi storage biasanya turun drastis setelah itu.
2. **Hapus project yang sudah tidak dipakai** (bukan sekadar pause) supaya seluruh deployment-nya ikut hilang.
3. Batasi preview deployment: hanya deploy branch yang sedang dikerjakan. Setiap deploy baru menambah satu salinan fungsi (aplikasi ini membawa `sharp`/libvips dan font DejaVu, jadi satu deployment bisa puluhan MB).

### Yang sudah dirapikan dari sisi aplikasi

- **Frame Reel dihapus segera** setelah video jadi (`del()` di `api/reels`). Sebelumnya PNG 1080×1920 per scene (6–10 berkas per Reel) menumpuk selamanya — ini penyumbang terbesar Blob.
- **`/api/cron/blob-cleanup`** menyapu sisa berkas lama dengan batas dari env `BLOB_REEL_FRAME_DAYS` (1), `BLOB_REEL_VIDEO_DAYS` (30), `BLOB_QUIZ_DAYS` (45), `BLOB_ARTICLE_IMAGE_DAYS` (21). Jalankan dulu dengan `?dryRun=1`, lalu tanpa parameter; pasang sebagai tugas mingguan di cron-job.org. Hanya prefix milik sendiri (`reels/`, `quiz/`, `article-images/`) yang pernah dihapus.
- Foto artikel disimpan dengan nama tetap per artikel (`allowOverwrite`), jadi artikel yang diproses ulang tidak menggandakan berkas.

Jika kuota Blob tetap terasa sempit (video Reels cepat memakan 1 GB), media bisa dipindah ke Supabase Storage; kontrak penyimpanan di `src/lib/blob-image.ts` dan `api/reels` sengaja dibuat kecil supaya penggantinya cuma satu adapter.

## Pemeriksaan dan catatan penting

```bash
npm run typecheck
npm run lint
npm run build
```

Artikel yang gagal tersimpan dengan status `failed`; setelah memperbaiki konfigurasi, masukkan ulang dengan endpoint retry. Setelah Buffer menerima post, artikel ditandai `ready` dengan referensi antrean Buffer supaya tidak dikirim ulang oleh siklus cron berikutnya. Dashboard membedakannya sebagai **Antrean Buffer**; status publikasi aktual dapat dilihat di Buffer.

Ringkasan AI tidak menjamin kebenaran atau verifikasi fakta. Periksa kualitas feed dan hasil secara berkala. Gunakan hanya teks dan gambar yang penggunaannya diizinkan; **menaruh tautan sumber di komentar tidak otomatis menghapus kewajiban hak cipta atau kebijakan Meta**. Pertimbangkan review manual sebelum publikasi otomatis.

## Pembaruan Tebak Drama: preview wajib sebelum publikasi

Mekanisme siluet lama diganti **potongan poster berwarna**: warna, pakaian,
pemain, dan suasana tetap menjadi petunjuk. Grid 2×3 (lima poster + brand) tetap
dipakai; tidak ada skor, kunci jawaban, pilihan wajib, atau penilaian audiens.
Cropping deterministik tidak memanggil AI dan **tidak menjamin seluruh tulisan
judul hilang**. Admin wajib memeriksa petunjuk dan hak penggunaan materi sumber.

**Sebelum deploy kode ini**, jalankan `drizzle/0019_quiz_preview.sql` pada database
Neon yang sama dengan `DATABASE_URL` (setelah migrasi `0010`). Migrasi aman diulang;
edisi lama tanpa publikasi diberi status `legacy`, bukan otomatis menjadi draf
yang dapat disetujui. Skema instalasi baru juga ada di `drizzle/schema.sql`.

Alur dashboard tab **Kuis**:
1. **Buat preview kuis** (atau cron GET terjadwal) hanya merender dan menyimpan draf.
2. Periksa gambar, caption, dan tautan sumber kelima poster.
3. **Setujui & terbitkan preview** menerbitkan edisi yang diperiksa ke Facebook;
   mirror Instagram tetap mengikuti konfigurasi lama.
4. **Tolak preview** bila petunjuk membingungkan/terlalu mudah atau hak penggunaan
   tidak jelas, kemudian buat edisi baru. Draf yang ditolak tidak menghabiskan
   kuota pemakaian poster.

API terproteksi `Authorization: Bearer <CRON_SECRET>`:
- `GET /api/quiz` mengikuti jadwal lama, **tidak pernah mempublikasikan**.
- `POST /api/quiz` dengan `{ "action": "create" }` membuat preview di luar jadwal.
- `POST /api/quiz` dengan `{ "action": "approve", "editionId": "<id-draf>" }`
  menyetujui sekaligus menerbitkan **draf tersimpan**, bukan regenerasi gambar.
- `POST /api/quiz` dengan `{ "action": "reject", "editionId": "<id-draf>" }`
  menolak draf.

Klaim status `draft → publishing` dilakukan atomik untuk mencegah persetujuan
ganda. Edisi `failed`, `legacy`, atau `publishing` tidak bisa disetujui ulang.
Jika Facebook timeout atau status tertahan pada `publishing`, periksa halaman
Facebook dan log sebelum tindakan manual; tidak ada retry otomatis yang berisiko
duplikasi. Tidak ada fitur edit draf pada alur ini—perubahan berarti menolak dan
membuat preview baru yang membutuhkan persetujuan baru. Jadwal cron kini adalah
jadwal **pembuatan preview**, bukan janji waktu tayang.

Pengujian lokal: `npm run typecheck`, `npm run lint`, `npm test`.
Pengujian Facebook/Blob nyata memerlukan konfigurasi deployment dan persetujuan
admin; tes lokal tidak menerbitkan konten ke akun mana pun.

## Konten Artis: Bio Artis dan Sorotan Artis/Idol

Tab **Konten Artis** menyediakan satu modul dengan dua segmen:
- **Bio Artis** (`artist_bio`): perkenalan, awal karier, karya penting, dan konteks editorial.
- **Sorotan Artis/Idol** (`artist_spotlight`): satu tema dengan empat foto dan konteks masing-masing.

### Setup dan penggunaan

1. Jalankan `drizzle/0020_artist_content.sql` di Neon sebelum deploy. SQL ini juga
   disertakan dalam `drizzle/schema.sql` untuk instalasi baru. Tidak ada migrasi
   database otomatis saat membuka dashboard.
2. Pastikan `BLOB_READ_WRITE_TOKEN` dan konfigurasi Facebook langsung Hiburan
   (`FB_ENTERTAINMENT_PAGE_ID`, `FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN`) tersedia.
   Modul ini **tidak memakai Buffer**. Instagram opsional memakai konfigurasi lama.
3. Buka tab Konten Artis, pilih segmen, isi nama, tema, sudut editorial, pertanyaan,
   dan **tepat empat slide**. Setiap slide wajib memiliki judul, fakta/konteks,
   sumber fakta HTTPS, URL langsung foto, halaman sumber foto, dan kredit.
   Konfirmasikan hak penggunaan foto. Kredit bukan pengganti izin.
4. **Simpan draf**. Caption kosong disusun deterministik dari bahan editor, termasuk
   sumber dan kredit. Caption bisa ditulis manual. Bantuan AI bersifat opsional,
   memakai failover provider yang sudah ada, dan hanya menerima fakta serta sudut
   editorial yang diisi—tidak melakukan riset/scraping fakta. Periksa klaim hasil AI,
   simpan hasilnya, dan sesuaikan caption bila fakta berubah.
5. **Buat preview revisi tersimpan**. Foto diunduh lewat pengambil gambar aman yang
   sudah ada, lalu dirender menjadi empat JPEG 1080×1080 dengan identitas PopBeez
   dan kredit foto. Bila satu foto gagal, tidak ada preview lengkap yang bisa
   diterbitkan. Preview diunggah ke Blob publik; jangan memakai materi rahasia.
6. Periksa empat slide serta caption tersimpan, kemudian **Setujui & terbitkan**.
   Yang dipublikasikan adalah empat file preview yang sama dalam urutan tersimpan,
   bukan render ulang. Publikasi manual dilakukan saat disetujui, bukan slot cron.

### Pengamanan alur

- Konten disimpan pada tabel `artist_contents`, terpisah dari antrean RSS supaya
  draft tidak dipanen, dikurasi, atau diterbitkan otomatis.
- Mengedit draf/preview dan menyimpannya menaikkan `revision`, menghapus preview,
  serta membatalkan kesiapan publikasi. Perubahan yang belum disimpan mematikan
  tombol preview/publikasi di UI.
- Satu preview dibuat per revisi. Untuk membuat ulang, simpan revisi baru terlebih
  dahulu; ini juga mencegah persetujuan berlomba dengan regenerasi preview.
- Klaim `draft → rendering` dan `preview → publishing` menggunakan pembaruan
  bersyarat status/revisi. Edisi published/failed tidak bisa disetujui ulang.
- Kegagalan mirror Instagram tidak membatalkan status published di Facebook.
  Caption panjang dapat ditolak Instagram meskipun Facebook berhasil; detail
  dicatat di edisi. Tidak ada retry publikasi otomatis.
- Jika rendering/publishing tertahan (misalnya function timeout) atau Facebook
  mengembalikan hasil tidak pasti, periksa log, database, dan halaman Facebook
  sebelum pemulihan manual. UI sengaja tidak membuka kunci otomatis.
- File preview `artist/` belum masuk penghapusan Blob otomatis. Pantau kuota dan
  bersihkan render yang tidak dipakai secara manual; jangan hapus preview aktif.

`artist_contents` mencatat `segment`, `format=carousel_4`, revisi, waktu persetujuan,
waktu tayang, ID Facebook/Instagram, serta error. **Perbandingan Insights lintas
segmen belum ditambahkan** pada panel analitik lama; modul ini menyediakan rekaman
publikasinya terlebih dahulu. Daftar dashboard menampilkan 50 edisi terbaru.

API admin: `GET /api/admin/artist-content` untuk daftar; `POST` dengan `action`
`save`, `ai`, `preview`, atau `approve`. Semuanya memerlukan bearer `CRON_SECRET`.
`save`/`ai` menerima `content`; pembaruan/publikasi menerima `id` dan `revision`.
Tidak ada post baru yang dibuat hanya dengan menyimpan draf atau meminta AI.

## Tebak Drama: tingkat kesulitan dan penggantian per nomor

Jalankan **`drizzle/0021_quiz_difficulty.sql`** setelah migrasi `0019` sebelum
mendeploy pembaruan ini. Kuis baru memakai **Sedang · mosaik warna** pada kelima
nomor secara default, bukan foto tajam atau siluet.

Pada preview berstatus `draft`, editor menyediakan pengaturan per nomor:
- **Mudah**: crop berwarna dengan blur ringan.
- **Sedang**: crop berwarna dengan mosaik 36×24, diperbesar nearest-neighbour.
- **Sulit**: crop hitam-putih dengan mosaik 18×12.

Efek hanya mengenai foto; nomor soal, logo, dan panel brand tetap tajam. Tidak
ada penghapusan fitur wajah, deteksi wajah, skor, atau kunci jawaban. Tingkat
kesulitan bersifat editorial: periksa hasil pada ukuran layar ponsel karena
poster/pemain yang terkenal mungkin tetap mudah dikenali. Cropping dan efek
ini bukan jaminan penghapusan seluruh teks judul.

**Mengganti satu poster:** gunakan pilihan poster pada nomor yang bersangkutan.
Empat nomor lain, urutan, dan tingkat kesulitannya tidak diacak. Pilihan berasal
dari review manual, mengikuti batas pemakaian poster yang sudah ada, bukan URL
bebas dari browser. Jika hanya ada lima poster, tambahkan review untuk memperluas
pilihan. Server memeriksa lima poster/judul yang berbeda dan memuat ulang sumber
metadata dari pool tepercaya. Penggantian tidak mengubah caption umum kuis.

Klik **Buat preview perubahan**, periksa gambar baru, baru kemudian **Setujui &
terbitkan preview**. Selama pengaturan lokal belum dirender, persetujuan di UI
nonaktif. Preview baru selalu memakai URL Blob unik; persetujuan serta penolakan
harus menyertakan URL preview yang diperiksa. Pembaruan status bersyarat
mencegah klik ganda dan menolak tab lama setelah preview diganti. Perubahan
menghapus persetujuan sebelumnya dan tidak mempublikasikan apa pun.

Jika render/unduhan gagal, pilihan tersimpan dan preview lama dipertahankan;
pengaturan gagal tidak disimpan setengah jalan. Jika function terhenti dan edisi
tertahan pada `editing`, periksa log serta status database sebelum pemulihan
manual. Tidak ada pembukaan kunci atau publikasi ulang otomatis.

Edisi lama tidak diubah gambarnya otomatis. Bila menyunting edisi lama yang belum
memiliki metadata efek, editor memulai dari Sedang untuk kelima nomor; buat preview
baru untuk menerapkan efek tersebut. File preview lama tetap mengikuti retensi
Blob kuis yang sudah ada.

Endpoint admin terproteksi: `GET /api/admin/quiz-edit?id=<editionId>` mengambil
pilihan dan pengaturan, `POST /api/admin/quiz-edit` menerima
`{ editionId, previewUrl, tiles: [{ imageUrl, difficulty }, ...] }` dengan tepat
lima tile. `POST /api/quiz` untuk `approve`/`reject` kini juga wajib menerima
`previewUrl`; pemanggil lama perlu diperbarui. Jadwal cron tidak berubah dan
tetap hanya menyiapkan draf.
