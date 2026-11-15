import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { runNewsPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runNewsPipeline();
    return NextResponse.json({ ok: result.result !== "failed", ...result }, { status: result.result === "failed" ? 502 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan server.";
    console.error("[cron]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
