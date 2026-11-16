import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { AiGenerationError, writeNewsCopy } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const startedAt = Date.now();
  const requestId = request.headers.get("x-vercel-id") ?? "unknown";
  try {
    const result = await writeNewsCopy({
      title: "Uji teknis koneksi AI",
      rawText: "Ini teks sintetis untuk pemeriksaan teknis. Ini bukan berita nyata dan tidak boleh dianggap sebagai fakta atau dipublikasikan.",
      category: "UJI SISTEM",
      sourceName: "Uji teknis internal",
    });
    const response = {
      ok: true,
      requestId,
      provider: result.provider,
      model: result.model,
      elapsedMs: result.elapsedMs,
      attempts: result.attempts,
      detail: "Provider berhasil menghasilkan respons uji. Konten ini tidak disimpan atau dikirim ke Buffer.",
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
