import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { pruneBlobStorage } from "@/lib/blob-retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Housekeeping for the account-wide Vercel Blob quota (1 GB on Hobby).
 * Runs weekly from cron-job.org; `?dryRun=1` only reports what would be removed.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const searchParams = request.nextUrl.searchParams;
  const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
  try {
    const result = await pruneBlobStorage({ dryRun });
    console.info(`[blob-prune] dryRun=${result.dryRun} scanned=${result.scanned} deleted=${result.deleted} bytes=${result.bytesFreed}`);
    return NextResponse.json({
      ok: true,
      ...result,
      megabytesFreed: Math.round((result.bytesFreed / 1_048_576) * 10) / 10,
      detail: dryRun
        ? "Simulasi saja: tidak ada berkas yang dihapus. Jalankan tanpa ?dryRun=1 untuk membersihkan."
        : `Bersih-bersih selesai: ${result.deleted} berkas (${Math.round((result.bytesFreed / 1_048_576) * 10) / 10} MB) dihapus.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pembersihan Blob gagal.";
    console.error("[blob-prune] gagal:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
