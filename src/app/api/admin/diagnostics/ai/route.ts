import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { AiGenerationError, writeNewsCopy } from "@/lib/ai";
import { EDITORIAL_VOICES } from "@/lib/editorial-voices";
import { PILLARS } from "@/lib/pillars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id") ?? "unknown";
  const stories = [
    { title: "Grup fiktif Luma umumkan mini album", sourceName: "Sumber uji satu", category: "Musik", rawText: "Materi ini sepenuhnya sintetis. Grup fiktif Luma mengumumkan mini album berisi lima lagu untuk bulan depan. Agensi mengatakan proses rekaman telah selesai, tetapi belum mengumumkan tanggal rilis atau daftar lagu. Pengumuman disertai foto konsep berwarna biru." },
    { title: "Aktor fiktif Raka bintangi serial misteri", sourceName: "Sumber uji dua", category: "Drama", rawText: "Materi ini sepenuhnya sintetis. Aktor fiktif Raka menjadi pemeran utama serial misteri enam episode yang dijadwalkan tayang di layanan streaming pada musim gugur. Rumah produksi menyebut proses syuting berlangsung di tiga kota, tetapi belum merilis nama karakter." },
    { title: "Webtoon fiktif Nara diadaptasi jadi animasi", sourceName: "Sumber uji tiga", category: "Hiburan", rawText: "Materi ini sepenuhnya sintetis. Webtoon fiktif Nara mendapat adaptasi animasi yang diumumkan oleh penerbitnya. Studio belum menyebut jadwal tayang maupun pengisi suara. Komik tersebut telah berjalan selama empat tahun dan pengumuman adaptasi disertai ilustrasi baru." },
    { title: "Festival fiktif PopWave tambah panggung", sourceName: "Sumber uji empat", category: "Pop culture", rawText: "Materi ini sepenuhnya sintetis. Festival musik fiktif PopWave menambah satu panggung untuk edisi berikutnya setelah tiket awal habis terjual. Panitia mengatakan daftar penampil tambahan akan diumumkan pekan depan, tanpa mengungkap nama artis atau kapasitas lokasi." },
  ];
  try {
    const result = await writeNewsCopy({
      title: stories[0]!.title,
      rawText: stories[0]!.rawText,
      category: stories[0]!.category,
      sourceName: stories[0]!.sourceName,
      voice: EDITORIAL_VOICES[0],
      pillar: PILLARS.breaking.id,
      roundupArticles: stories,
    });
    const response = {
      ok: true,
      requestId,
      provider: result.provider,
      model: result.model,
      elapsedMs: result.elapsedMs,
      attempts: result.attempts,
      detail: "Provider berhasil menghasilkan roundup sintetis 4 cerita dengan format editorial. Konten uji ini tidak disimpan atau dikirim ke Buffer.",
    };
    console.info(`[diagnostics:ai] ${JSON.stringify(response)}`);
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const response = {
      ok: false,
      requestId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Uji koneksi AI gagal.",
      attempts: error instanceof AiGenerationError ? error.attempts : [],
    };
    console.error(`[diagnostics:ai] ${JSON.stringify(response)}`);
    return NextResponse.json(response, { status: 502, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
