import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDiagnosticsSnapshot, recordAutomationEvent } from "@/lib/automation-log";
import { harvestLatestStories } from "@/lib/harvest";
import { AiGenerationError, writeNewsCopy } from "@/lib/ai";
import { EDITORIAL_VOICES } from "@/lib/editorial-voices";
import { PILLARS } from "@/lib/pillars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  try {
    const diagnostics = await getDiagnosticsSnapshot(40);
    return NextResponse.json(
      { ok: true, diagnostics },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat diagnostik sistem.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  let body: { runHarvest?: boolean; probeAi?: boolean } = {};
  try {
    body = (await request.json()) as { runHarvest?: boolean; probeAi?: boolean };
  } catch {
    body = {};
  }

  let harvestResult: Record<string, unknown> | null = null;
  let aiResult: Record<string, unknown> | null = null;

  if (body.runHarvest) {
    try {
      const summary = await harvestLatestStories({ budgetMs: 22_000 });
      harvestResult = { ok: true, ...summary };
      await recordAutomationEvent({
        source: "harvest",
        trigger: "manual",
        outcome: summary.feedsTotal > 0 && summary.feedsFailed >= summary.feedsTotal ? "error" : "ok",
        summary: `Panen RSS dari panel diagnostik: +${summary.added} baru (${summary.feedsTotal - summary.feedsFailed}/${summary.feedsTotal} feed sukses, ${summary.elapsedMs} ms).`,
        detail: summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Panen RSS gagal.";
      harvestResult = { ok: false, error: message };
      await recordAutomationEvent({
        source: "harvest",
        trigger: "manual",
        outcome: "error",
        summary: `Panen RSS dari panel diagnostik gagal: ${message}`,
        detail: { error: message },
      });
    }
  }

  if (body.probeAi) {
    const startedAt = Date.now();
    const requestId = request.headers.get("x-vercel-id") ?? `sysdiag-${startedAt}`;
    const stories = [
      { title: "Grup fiktif Luma umumkan mini album", sourceName: "Sumber uji satu", category: "Musik", rawText: "Materi ini sepenuhnya sintetis. Grup fiktif Luma mengumumkan mini album berisi lima lagu untuk bulan depan." },
      { title: "Aktor fiktif Raka bintangi serial misteri", sourceName: "Sumber uji dua", category: "Drama", rawText: "Materi ini sepenuhnya sintetis. Aktor fiktif Raka menjadi pemeran utama serial misteri enam episode pada musim gugur." },
      { title: "Webtoon fiktif Nara diadaptasi jadi animasi", sourceName: "Sumber uji tiga", category: "Hiburan", rawText: "Materi ini sepenuhnya sintetis. Webtoon fiktif Nara mendapat adaptasi animasi yang diumumkan oleh penerbitnya." },
      { title: "Festival fiktif PopWave tambah panggung", sourceName: "Sumber uji empat", category: "Pop culture", rawText: "Materi ini sepenuhnya sintetis. Festival musik fiktif PopWave menambah satu panggung untuk edisi berikutnya pekan depan." },
    ];
    try {
      const probe = await writeNewsCopy({
        title: stories[0]!.title,
        rawText: stories[0]!.rawText,
        category: stories[0]!.category,
        sourceName: stories[0]!.sourceName,
        voice: EDITORIAL_VOICES[0],
        pillar: PILLARS.breaking.id,
        roundupArticles: stories,
      });
      aiResult = {
        ok: true,
        requestId,
        provider: probe.provider,
        model: probe.model,
        elapsedMs: probe.elapsedMs,
        attempts: probe.attempts,
        detail: "Provider berhasil menghasilkan roundup sintetis 4 cerita.",
      };
      await recordAutomationEvent({
        source: "diagnostic",
        trigger: "manual",
        outcome: "ok",
        summary: `Uji AI sukses (${probe.provider} · ${probe.model}, ${probe.elapsedMs} ms).`,
        detail: aiResult,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Uji AI gagal.";
      const attempts = error instanceof AiGenerationError ? error.attempts : [];
      aiResult = {
        ok: false,
        requestId,
        elapsedMs: Date.now() - startedAt,
        error: message,
        attempts,
      };
      await recordAutomationEvent({
        source: "diagnostic",
        trigger: "manual",
        outcome: "error",
        summary: `Uji AI gagal: ${message}`,
        detail: aiResult,
      });
    }
  }

  try {
    const diagnostics = await getDiagnosticsSnapshot(40);
    return NextResponse.json(
      { ok: true, diagnostics, harvestResult, aiResult },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memuat diagnostik sistem.";
    return NextResponse.json({ ok: false, error: message, harvestResult, aiResult }, { status: 500 });
  }
}
