# API read-only untuk landing HiveComp

Implementasi backend Next.js/Neon ini menyediakan feed kecil untuk dipanggil **server landing**, bukan browser. Pembuatan endpoint ini tidak otomatis men-deploy aplikasi atau mengubah environment Vercel.

## 1. Kontrak endpoint

```text
GET /api/pages/:brand/posts?limit=3
Authorization: Bearer <HIVECOMP_API_TOKEN>
```

| Brand (case-sensitive) | Channel Neon `page_key` |
| --- | --- |
| `popbeez` | `entertainment` |
| `nusabeez` | `news` |

- Default `limit=3`; nilai integer positif boleh 1 atau 2; nilai di atas 3 dibatasi ke 3. Parameter kosong/tidak valid/0/negatif memakai default 3.
- Urutan berdasarkan `published_at DESC, id DESC`, bukan waktu panen RSS. Maksimal 3 baris dibaca dalam satu query.
- Token wajib untuk semua GET posts, termasuk brand asing. Tanpa/salah token → 401; brand asing dengan token valid → 404. Token backend yang belum disetel → 500 (fail closed).
- Sukses dan error posts sama-sama memiliki `items` berupa array; hasil kosong adalah `{"items":[]}`, bukan `null`.
- GET sukses: `Cache-Control: public, max-age=300` dan `Vary: Authorization`. Error dan health memakai `Cache-Control: no-store` agar kegagalan/auth/hasil health tidak di-cache publik. Jangan mengatur CDN untuk mengabaikan `Authorization`/`Vary` atau memaksa cache error.
- Semua respons yang ditangani endpoint ini JSON; POST, PUT, PATCH, DELETE, OPTIONS, dan HEAD ditolak dengan 405 dan `Allow: GET`. Sesuai protokol HTTP, respons HEAD tetap tanpa body di jaringan, dengan status/header yang sama.
- Tidak mengirim `Access-Control-Allow-Origin: *`, maupun header izin CORS lain. Jangan menambahkan wildcard CORS di proxy. Permintaan landing harus server-to-server.

Contoh bentuk respons sukses **ilustratif, bukan data produksi**:

```json
{
  "items": [
    {
      "id": "7e2b6418-5ea0-4b75-8c1c-68ca80f447c4",
      "message": "Teks caption postingan",
      "full_picture": "https://backend-anda.com/api/og/7e2b6418-5ea0-4b75-8c1c-68ca80f447c4",
      "created_time": "2026-02-10T08:00:00.000Z"
    }
  ]
}
```

### Sumber data dan batasan yang penting

Endpoint membaca tabel `articles` yang sudah ada, **tidak memanggil API Facebook/Buffer** dan tidak melakukan sinkronisasi/penulisan:

1. Hanya `status = 'published'`, memiliki `facebook_post_id` numerik Facebook (ID tunggal atau `pageId_postId`), serta `published_at` yang tidak kosong dan tidak di masa depan.
2. **Referensi `buffer:*`, termasuk `buffer:pending:*`, bukan bukti post Facebook sudah tayang.** Referensi itu selalu dikecualikan, sekalipun baris lama salah ditandai `published`. Konten `queued`, `processing`, `ready`, dan `failed` juga tidak dikirim.
3. Publisher sekarang menyimpan kiriman Buffer sebagai `ready`. Belum ada sinkronisasi status publikasi dari Buffer ke Neon. Karena itu feed **dapat kosong meskipun Buffer sudah menerbitkan konten**; hanya publikasi terkonfirmasi yang sudah tersimpan (misalnya post langsung lama) tampil. Jangan mengubah status antrean menjadi `published` hanya untuk mengisi landing. Sinkronisasi publikasi terverifikasi adalah pekerjaan terpisah.
4. `id` adalah UUID artikel Neon yang nyata, bukan ID Facebook buatan. `message` memakai caption, atau judul tersimpan bila caption kosong; konten tanpa id/pesan tidak dikirim.
5. `created_time` opsional, hanya dari `published_at` valid dan diserialisasi ISO 8601 UTC (`...Z`). Waktu panen/`created_at` tidak dipalsukan sebagai waktu publikasi.
6. `full_picture` opsional: URL kartu OG yang memang disediakan backend bila `APP_URL` HTTPS publik valid; jika tidak, URL gambar artikel HTTPS publik yang aman jika tersedia. URL relatif/HTTP/lokal, URL berkredensial, serta URL dengan parameter rahasia tidak dikirim. URL kartu berasal dari environment tepercaya, bukan header Host klien.
7. Skema belum menyimpan `permalink_url`, `reactions`, `comments`, atau `shares`, sehingga field ini **dihilangkan**, bukan diisi nol atau angka contoh. Jika nanti ditambahkan lewat sumber terverifikasi, hitungan harus angka JSON, bukan string seperti `"1.2k"`.
8. Query memakai allowlist kolom konten publik; tidak mengambil raw text, error internal, kontak admin, atau kredensial. Serializer juga meredaksi pola email/telepon umum, Bearer credential, dan token HiveComp yang tidak sengaja tertanam di caption. Tetap tinjau caption sebelum publikasi; redaksi pola bukan pengganti kurasi data pribadi.

### Rate limit dan target latensi

- Proteksi aplikasi: **60 request/menit/IP per endpoint per instance aktif**, termasuk token salah dan metode yang ditolak. Respons menyertakan `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (detik hingga reset). Saat habis: 429 JSON + `Retry-After` dalam detik. Memori dibatasi dan counter aktif tidak dihapus untuk menerima IP baru.
- Ini limiter memori, **bukan kuota global terdistribusi**: restart/cold start atau instance lain memiliki counter lain. Untuk produksi multi-instance, tambahkan rate limiting di ingress/hosting (misalnya Vercel Firewall sesuai paket) yang kompatibel dengan kontrak JSON; hindari challenge/login HTML untuk pemanggil API. Untuk kuota global ketat pada level aplikasi diperlukan shared rate-limit store terpisah.
- Header IP proxy hanya dipercaya bila hosting/proxy menimpanya. Untuk self-host, jangan izinkan klien memalsukan `X-Real-IP`/`X-Forwarded-For`.
- Query posts satu SELECT terbatasi + indeks `(page_key, status, published_at, id)`. Deadline pembacaan **1.500 ms** membatalkan fetch Neon yang lambat dan mengembalikan 500 JSON, bukan menggantung. Tidak ada fetch gambar/AI/Buffer/Facebook di endpoint posts.
- Target sukses <2 detik untuk 3 baris tetap perlu diukur pada hosting/Neon nyata, termasuk cold start dan jaringan; deadline tidak menjamin hasil sukses maupun total cold-start <2 detik. Pilih region function dekat Neon dan uji sebelum menghubungkan landing. Belum ada benchmark produksi dari workspace ini.

## 2. Environment variables backend

| Variabel | Wajib untuk API | Isi |
| --- | --- | --- |
| `HIVECOMP_API_TOKEN` | Ya untuk posts | Secret acak panjang (anjuran ≥32 karakter), terpisah dari `CRON_SECRET`. Hanya server. |
| `DATABASE_URL` | Ya untuk data/health | Connection string Neon Postgres aplikasi yang sudah ada; jangan kirim ke chat atau Git. |
| `APP_URL` | Opsional untuk feed; diperlukan publisher yang sudah ada | URL HTTPS publik backend, misalnya `https://backend-anda.com`. Dipakai untuk URL news card; jika tidak valid, gambar artikel yang aman menjadi fallback. |

API posts tidak membutuhkan key AI, token Meta, atau key Buffer. Variabel pipeline lain tetap diperlukan bila fitur publisher dipakai (lihat `.env.example`). Health hanya melaporkan boolean ketersediaan konfigurasi, tidak pernah nilainya. Gunakan secret yang berbeda untuk Preview dan Production bila sesuai; jangan gunakan prefix `NEXT_PUBLIC_` pada token/connection string.

Untuk membuat token, jalankan **di terminal pribadi**, lalu simpan hasilnya ke secret manager/environment backend dan server landing; jangan menempel hasilnya di chat:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 3. Contoh curl

Siapkan `BACKEND_URL` dan `HIVECOMP_API_TOKEN` di environment shell lokal secara aman. Ganti URL contoh dengan domain deployment sendiri.

```bash
export BACKEND_URL="https://backend-anda.com"

curl --fail-with-body -i \
  -H "Authorization: Bearer $HIVECOMP_API_TOKEN" \
  "$BACKEND_URL/api/pages/popbeez/posts?limit=3"

curl --fail-with-body \
  -H "Authorization: Bearer $HIVECOMP_API_TOKEN" \
  "$BACKEND_URL/api/pages/nusabeez/posts?limit=2"

# Health publik, tidak memerlukan token.
curl --fail-with-body -i "$BACKEND_URL/api/health"

# Ukur latensi GET sebenarnya, termasuk TLS/jaringan.
curl -sS -o /dev/null -w 'HTTP %{http_code}; total %{time_total}s\n' \
  -H "Authorization: Bearer $HIVECOMP_API_TOKEN" \
  "$BACKEND_URL/api/pages/popbeez/posts?limit=3"
```

### Contoh respons gagal

401, token hilang/salah (`WWW-Authenticate: Bearer realm="hivecomp"`):

```json
{ "items": [], "error": "unauthorized" }
```

404, brand asing dengan token valid:

```json
{ "items": [], "error": "brand_not_found" }
```

405, metode selain GET (`Allow: GET`):

```json
{ "items": [], "error": "method_not_allowed" }
```

500, error internal/database/deadline (detail internal tidak dikirim):

```json
{ "items": [], "error": "internal_server_error" }
```

500 bila `HIVECOMP_API_TOKEN` belum diatur:

```json
{ "items": [], "error": "server_configuration_error" }
```

429, batas request tercapai (`Retry-After` ditentukan saat request):

```json
{ "items": [], "error": "too_many_requests" }
```

Uji error tanpa menulis data:

```bash
curl -i -H 'Authorization: Bearer salah' "$BACKEND_URL/api/pages/popbeez/posts"
curl -i -H "Authorization: Bearer $HIVECOMP_API_TOKEN" "$BACKEND_URL/api/pages/asing/posts"
curl -i -X POST "$BACKEND_URL/api/pages/popbeez/posts"
```

## 4. GET /api/health

Publik, JSON, rate limit sama (bucket endpoint terpisah), tidak di-cache. Hanya menjalankan SELECT untuk konektivitas, tabel RSS/kolom keywords, dan singleton publisher yang dibuat migrasi. **Tidak lagi menyisipkan/memperbaiki baris `publisher_state`.**

- 200: database dan skema siap (`ok: true`), jumlah feed aktif, serta flag boolean integrasi.
- 503: database tidak tersedia atau migrasi/seed singleton belum lengkap (`ok: false`). Jalankan migrasi secara administratif, bukan lewat health.
- 405 untuk metode non-GET, 429 saat dibatasi, 500 JSON untuk deadline/error tak terduga. Untuk HEAD tidak ada body sesuai HTTP.
- Health tidak menguji validitas key AI/Buffer/Meta dan tidak menerbitkan konten. `hivecompApi: true` hanya berarti token tersedia, bukan feed pasti terisi.

## 5. Deploy pada Vercel

1. Gunakan project backend yang terhubung ke repository ini, framework **Next.js**, Node.js **22.x** (atau versi Node kompatibel), install `npm ci`, build `npm run build`, output default Next.js. Publikasikan perubahan melalui proses Git/deployment biasa; dokumen ini tidak melakukan push, merge, atau redeploy.
2. Di **Settings → Environment Variables**, tambahkan `HIVECOMP_API_TOKEN`, pastikan `DATABASE_URL` benar, dan set `APP_URL` ke domain HTTPS backend. Pilih environment yang tepat (Production, serta Preview jika diuji). Token tidak diperlukan saat build, tetapi wajib saat GET posts berjalan.
3. Database baru: gunakan skema pada `drizzle/schema.sql` sesuai README. Database yang sudah ada: jalankan `drizzle/0004_hivecomp_posts_index.sql` sekali dari Neon SQL Editor/proses migrasi administratif. Indeks baru tidak mengisi atau mengubah data posting. Migrasi RSS/publisher `0001`–`0003` tetap diperlukan sesuai versi database; jangan menjalankan skema awal ulang pada database berisi data.
4. Pilih region function dekat region Neon. Pastikan domain production dapat diakses server landing tanpa redirect/login HTML dari Deployment Protection; jangan membuka endpoint admin hanya untuk menguji feed.
5. Deploy perubahan atau **Deployments → deployment kode terbaru → Redeploy** setelah env berubah. Redeploy kode lama saja tidak akan menambahkan endpoint baru.
6. Jalankan curl health dan posts di atas. Verifikasi 200, `items` array (kosong sah), content type, cache header, 401/404/405 JSON, serta latensi. Jangan memanggil cron/publisher untuk tes feed karena endpoint itu dapat menambahkan konten sungguhan ke Buffer.
7. Tambahkan rate limiting tingkat ingress untuk produksi multi-instance, dengan perilaku JSON yang sesuai. Jangan mengandalkan limiter memori untuk batas global.

### Environment server landing HiveComp

Setelah backend tersedia, di project Vercel **landing** → **Settings → Environment Variables**:

| Variabel | Nilai |
| --- | --- |
| `POPBEEZ_API_URL` | `https://backend-anda.com/api/pages/popbeez/posts` (ganti domain) |
| `POPBEEZ_API_TOKEN` | Nilai yang sama dengan `HIVECOMP_API_TOKEN` backend |

Lalu **Redeploy landing**. Keduanya dibaca oleh kode server landing; token tidak boleh masuk Client Component, JavaScript browser, log, repository, atau variabel `NEXT_PUBLIC_*`. Kirim token hanya dalam header `Authorization`, bukan query URL. Untuk brand `nusabeez`, gunakan rute `/api/pages/nusabeez/posts` pada integrasi server yang sesuai.

### Hosting Node.js sendiri

Alternatif: Node 22 + reverse proxy HTTPS. Siapkan env server, jalankan `npm ci`, `npm run build`, kemudian `npm run start -- --port 3000` melalui process manager hosting. Script start sudah bind `0.0.0.0`. Arahkan domain/proxy ke port aplikasi, teruskan `Authorization`, pertahankan `Vary: Authorization`, dan timpa header IP dari klien dengan IP tepercaya. Tidak perlu server/backend kedua atau CORS wildcard. Jangan mengekspos port database atau file `.env`.

## 6. Kode dan pengujian

- `src/app/api/pages/[brand]/posts/route.ts`: pengikatan route Next.js untuk GET dan metode yang ditolak.
- `src/lib/hivecomp-api.ts`: auth, brand/limit, serializer allowlist, kontrak respons posts.
- `src/lib/read-only-api.ts`: JSON/method guard, limiter memori, deadline/abort.
- `src/lib/read-only-data.ts`: SELECT feed dan pemeriksaan health tanpa write.
- `src/app/api/health/route.ts`, `src/lib/health-api.ts`: health read-only.
- `tests/hivecomp-api.test.ts`, `tests/hivecomp-routes.test.ts`, `tests/read-only-data.test.ts`: kontrak/keamanan/error/query, memakai data uji/driver mock, tidak menulis database atau menerbitkan post.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Pengujian lokal tidak menggantikan verifikasi kredensial Neon, migrasi, kelengkapan data publikasi, rate limit terdistribusi, dan latensi deployment produksi.
