import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { harvestLatestStories } from "@/lib/harvest";
import { recordAutomationEvent } from "@/lib/automation-log";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handleHarvest(request: NextRequest, method: "GET" | "POST") {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  const trigger = request.nextUrl.searchParams.get("manual") === "1" ? "manual" : "scheduled";

  try {
    const summary = await harvestLatestStories({ budgetMs: 22_000 });
    const outcome = summary.feedsTotal > 0 && summary.feedsFailed >= summary.feedsTotal ? "error" : "ok";
    await recordAutomationEvent({
      source: "harvest",
      trigger,
      outcome,
      summary: `Panen RSS (${method}): ${summary.added} baru dari ${summary.scanned} item (${summary.feedsTotal - summary.feedsFailed}/${summary.feedsTotal} feed sukses, ${summary.elapsedMs} ms).`,
      detail: {
        method,
        ...summary,
      },
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Harvest gagal.";
    await recordAutomationEvent({
      source: "harvest",
      trigger,
      outcome: "error",
      summary: `Panen RSS gagal (${method}): ${message}`,
      detail: { method, error: message },
    });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleHarvest(request, "GET");
}

export async function POST(request: NextRequest) {
  return handleHarvest(request, "POST");
}
