import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { feedPresets } from "@/lib/feed-presets";
import { rssSources } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const imported = await getDb().insert(rssSources)
      .values(feedPresets)
      .onConflictDoNothing({ target: rssSources.feedUrl })
      .returning({ id: rssSources.id, active: rssSources.active });
    const inactive = imported.filter((feed) => !feed.active).length;
    return NextResponse.json({
      ok: true,
      added: imported.length,
      skipped: feedPresets.length - imported.length,
      inactive,
      total: feedPresets.length,
    });
  } catch (error) {
    console.error("[feed-presets]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal memasukkan preset feed. Pastikan migrasi database terbaru sudah dijalankan." }, { status: 503 });
  }
}
