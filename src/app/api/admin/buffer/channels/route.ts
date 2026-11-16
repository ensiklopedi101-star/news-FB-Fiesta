import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { listBufferChannels } from "@/lib/buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const channels = await listBufferChannels();
    return NextResponse.json({ channels }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tidak bisa mengambil daftar channel Buffer.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
