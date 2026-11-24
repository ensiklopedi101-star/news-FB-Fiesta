import { after, NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { isAuthorized } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { publisherState } from "@/lib/schema";
import { runNewsPipeline } from "@/lib/pipeline";
import { slotStateAt } from "@/lib/publish-slots";
import { maybeAutoHarvestBeforePublish } from "@/lib/harvest";
import { recordAutomationEvent } from "@/lib/automation-log";

export const runtime = "nodejs";
export const maxDuration = 120;

const CRON_LOCK_MS = 3 * 60 * 1000;

async function handleCron(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  // `?force=1` is sent by the dashboard's manual "Terbitkan" button; scheduled
  // triggers omit it and therefore obey the WITA slot schedule.
  const forced = request.nextUrl.searchParams.get("force") === "1";
  const trigger = forced ? "manual" : "scheduled";
  const schedule = slotStateAt(new Date());

  if (!forced && schedule.enabled && !schedule.active) {
    let autoHarvestSummary: Record<string, unknown> | null = null;
    try {
      const autoHarvest = await maybeAutoHarvestBeforePublish();
      if (autoHarvest.triggered && autoHarvest.summary) {
        autoHarvestSummary = { reason: autoHarvest.reason, ...autoHarvest.summary };
        await recordAutomationEvent({
          source: "cron-auto-harvest",
          trigger: "scheduled",
          outcome: autoHarvest.summary.feedsTotal > 0 && autoHarvest.summary.feedsFailed >= autoHarvest.summary.feedsTotal ? "error" : "ok",
          summary: `Auto-panen RSS di luar slot (${autoHarvest.reason}): +${autoHarvest.summary.added} artikel baru (${autoHarvest.summary.elapsedMs} ms).`,
          detail: autoHarvestSummary,
        });
      }
    } catch (harvestError) {
      const msg = harvestError instanceof Error ? harvestError.message : "Auto-harvest gagal.";
      await recordAutomationEvent({
        source: "cron-auto-harvest",
        trigger: "scheduled",
        outcome: "error",
        summary: `Auto-panen RSS gagal: ${msg}`,
        detail: { error: msg },
      });
    }

    await recordAutomationEvent({
      source: "cron",
      trigger,
      outcome: "outside-slot",
      summary: `Detak cron di luar slot tayang. Slot berikutnya ${schedule.nextSlot ?? "-"} WITA (${schedule.minutesUntilNextSlot ?? "-"} menit lagi).`,
      detail: {
        nextSlot: schedule.nextSlot,
        minutesUntilNextSlot: schedule.minutesUntilNextSlot,
        autoHarvest: autoHarvestSummary,
      },
    });

    return NextResponse.json({
      ok: true,
      result: "outside-slot",
      detail: schedule.nextSlot
        ? `Di luar jam tayang. Slot berikutnya pukul ${schedule.nextSlot} WITA (${schedule.minutesUntilNextSlot} menit lagi).`
        : "Di luar jam tayang terjadwal.",
      slots: schedule.slots,
      graceMinutes: schedule.graceMinutes,
      nextSlot: schedule.nextSlot,
      minutesUntilNextSlot: schedule.minutesUntilNextSlot,
      autoHarvest: autoHarvestSummary,
    });
  }

  const db = getDb();
  const lockUntil = new Date(Date.now() + CRON_LOCK_MS);
  const acquired = await db
    .insert(publisherState)
    .values({ id: 1, lockedUntil: lockUntil, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: publisherState.id,
      set: { lockedUntil: lockUntil, updatedAt: new Date() },
      where: sql`${publisherState.lockedUntil} < now()`,
    })
    .returning({ id: publisherState.id });

  if (!acquired.length) {
    await recordAutomationEvent({
      source: "cron",
      trigger,
      outcome: "busy",
      summary: "Siklus dilewati karena kunci publisher masih aktif.",
    });
    return NextResponse.json({ ok: true, result: "busy", detail: "Siklus publikasi sebelumnya masih berjalan." });
  }

  try {
    let autoHarvestSummary: Record<string, unknown> | null = null;
    try {
      const autoHarvest = await maybeAutoHarvestBeforePublish();
      if (autoHarvest.triggered && autoHarvest.summary) {
        autoHarvestSummary = { reason: autoHarvest.reason, ...autoHarvest.summary };
        await recordAutomationEvent({
          source: "cron-auto-harvest",
          trigger,
          outcome: autoHarvest.summary.feedsTotal > 0 && autoHarvest.summary.feedsFailed >= autoHarvest.summary.feedsTotal ? "error" : "ok",
          summary: `Auto-panen RSS sebelum terbit (${autoHarvest.reason}): +${autoHarvest.summary.added} artikel baru (${autoHarvest.summary.elapsedMs} ms).`,
          detail: autoHarvestSummary,
        });
      }
    } catch (harvestError) {
      const msg = harvestError instanceof Error ? harvestError.message : "Auto-harvest gagal.";
      await recordAutomationEvent({
        source: "cron-auto-harvest",
        trigger,
        outcome: "error",
        summary: `Auto-panen RSS sebelum terbit gagal: ${msg}`,
        detail: { error: msg },
      });
    }

    const result = await runNewsPipeline({
      deferBackgroundTask: forced ? undefined : (task) => after(task),
    });

    if (result.result === "failed") {
      await recordAutomationEvent({
        source: "cron",
        trigger,
        outcome: "error",
        summary: `Publikasi gagal: ${result.detail ?? "Tanpa rincian."}`,
        detail: { ...result, activeSlot: schedule.activeSlot, autoHarvest: autoHarvestSummary },
      });
      // Return HTTP 502 only for manual dashboard triggers (`?force=1`).
      // Scheduled cron-job.org triggers receive HTTP 200 with `ok: false` so external
      // schedulers do not auto-disable the cron job after transient editorial/AI holds.
      return NextResponse.json(
        { ok: false, ...result, error: result.detail, autoHarvest: autoHarvestSummary },
        { status: forced ? 502 : 200 },
      );
    }

    const outcome = result.result === "published" || result.result === "queued"
      ? "ok"
      : result.result === "rate-limited"
        ? "rate-limited"
        : "idle";
    await recordAutomationEvent({
      source: "cron",
      trigger,
      outcome,
      summary: result.title
        ? `${result.result}: ${result.title} — ${result.detail ?? ""}`
        : `${result.result}: ${result.detail ?? ""}`,
      detail: { ...result, activeSlot: schedule.activeSlot, autoHarvest: autoHarvestSummary },
    });

    return NextResponse.json({ ok: true, ...result, autoHarvest: autoHarvestSummary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proses berita gagal.";
    await recordAutomationEvent({
      source: "cron",
      trigger,
      outcome: "error",
      summary: `Eksepsi tidak tertangani di /api/cron: ${message}`,
      detail: { error: message, activeSlot: schedule.activeSlot },
    });
    return NextResponse.json(
      { ok: false, error: message },
      { status: forced ? 500 : 200 },
    );
  } finally {
    await db
      .update(publisherState)
      .set({ lockedUntil: new Date(0), updatedAt: new Date() })
      .where(eq(publisherState.id, 1))
      .catch(() => undefined);
  }
}

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
