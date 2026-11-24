import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import {
  getContentManagerOverview,
  simulateContentManagerFromQueue,
  updateContentManagerSettings,
} from "@/lib/content-manager";
import { PILLAR_IDS } from "@/lib/pillars";
import { EDITORIAL_VOICES } from "@/lib/editorial-voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  autoArchiveDuplicates: z.boolean().optional(),
  customDirective: z.string().max(600).optional(),
  focusPillars: z.array(z.enum(PILLAR_IDS as [typeof PILLAR_IDS[number], ...typeof PILLAR_IDS[number][]])).max(6).optional(),
  avoidKeywords: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  preferredVoice: z.enum(["auto", ...EDITORIAL_VOICES.map((voice) => voice.id)] as [string, ...string[]]).optional(),
}).strict();

async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Body harus berupa JSON yang valid.");
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const overview = await getContentManagerOverview();
    return NextResponse.json({ ok: true, ...overview }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[content-manager:get]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal membaca state Content Manager." }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "JSON tidak valid." }, { status: 400 });
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Pengaturan Content Manager tidak valid." }, { status: 400 });
  }
  try {
    const settings = await updateContentManagerSettings(parsed.data);
    const overview = await getContentManagerOverview();
    if (!overview.schemaReady) {
      return NextResponse.json({ error: "Memori Content Manager di Neon belum dapat dibuat. Jalankan drizzle/0017_content_manager.sql atau periksa izin database." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, settings, performance: overview.performance, eligibleQueueCount: overview.eligibleQueueCount });
  } catch (error) {
    console.error("[content-manager:put]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan Content Manager." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const simulation = await simulateContentManagerFromQueue();
    return NextResponse.json(simulation, { status: simulation.ok ? 200 : 422 });
  } catch (error) {
    console.error("[content-manager:simulate]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Simulasi Content Manager gagal. Periksa database atau antrean Hiburan." }, { status: 503 });
  }
}
