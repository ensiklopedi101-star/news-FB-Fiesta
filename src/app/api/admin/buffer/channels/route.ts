import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { checkBufferChannelMapping, listBufferChannels } from "@/lib/buffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const channels = await listBufferChannels();
    const mappings = {
      news: checkBufferChannelMapping(process.env.BUFFER_NEWS_CHANNEL_ID?.trim(), channels),
      entertainment: checkBufferChannelMapping(process.env.BUFFER_ENTERTAINMENT_CHANNEL_ID?.trim(), channels),
    };
    return NextResponse.json({ channels, mappings }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tidak bisa mengambil daftar channel Buffer.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
