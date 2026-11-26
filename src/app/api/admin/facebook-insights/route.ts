import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized } from "@/lib/auth";
import { recordAutomationEvent } from "@/lib/automation-log";
import { syncFacebookPostInsights } from "@/lib/facebook-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const requestSchema = z.object({ force: z.boolean().optional() }).strict();

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body harus berupa JSON yang valid." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Permintaan sinkronisasi Insights tidak valid." }, { status: 400 });
  }

  const result = await syncFacebookPostInsights({ force: parsed.data.force ?? false });
  await recordAutomationEvent({
    source: "facebook-insights",
    trigger: "manual",
    outcome: result.status === "failed" ? "error" : result.status === "synced" ? "ok" : "idle",
    summary: result.status === "synced"
      ? `Insights Facebook: ${result.syncedPosts} post tersinkron, ${result.partialPosts} parsial, ${result.failedPosts} gagal.`
      : `Sinkronisasi Facebook Insights berstatus ${result.status}${result.error ? `: ${result.error}` : "."}`,
    detail: result,
  });
  const status = result.status === "failed" ? 503 : 200;
  return NextResponse.json({ ok: result.status !== "failed", ...result }, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
