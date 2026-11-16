import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { harvestLatestStories } from "@/lib/harvest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await harvestLatestStories();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal mengambil feed RSS.";
    console.error("[harvest]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
