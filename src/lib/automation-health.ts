import { MAX_QUEUE_AGE_HOURS } from "@/lib/queue-policy";
import { POPBEEZ_ROUNDUP_MIN } from "@/lib/roundup";
import { PUBLISH_POLICY } from "@/lib/schedule";

export type AutomationSource = "cron" | "harvest" | "cron-auto-harvest" | "facebook-insights" | "quiz" | "reels" | "blob-cleanup" | "diagnostic";
export type AutomationTrigger = "scheduled" | "manual";
export type AutomationOutcome = "ok" | "idle" | "outside-slot" | "rate-limited" | "busy" | "error";

export type HealthLevel = "healthy" | "warning" | "critical";

export type AutomationIssue = {
  code:
    | "shortlink-host-conflict"
    | "no-active-feeds"
    | "rss-stale"
    | "cron-missing"
    | "publish-stalled"
    | "roundup-waiting-images"
    | "feeds-failing"
    | "articles-failed"
    | "automation-error"
    | "publisher-locked";
  severity: "warning" | "critical";
  title: string;
  detail: string;
};

export type AutomationHealthInput = {
  now: Date;
  activeFeedCount: number;
  failingFeedCount: number;
  lastFeedFetchedAt: Date | null;
  lastCronAt: Date | null;
  lastCronOutcome: string | null;
  lastHarvestAt: Date | null;
  lastPublishedAt: Date | null;
  queuedTotal: number;
  queuedEntertainment: number;
  imageEligibleEntertainment: number;
  failedArticlesLast24h: number;
  recentAutomationErrors: number;
  publisherLockedUntil: Date | null;
  appUrlHost: string | null;
  shortlinkOnlyHost: string | null;
};

export type AutomationHealthReport = {
  level: HealthLevel;
  hoursSinceLastPublish: number | null;
  minutesSinceLastCron: number | null;
  minutesSinceLastHarvest: number | null;
  issues: AutomationIssue[];
};

const AUTO_HARVEST_WHEN_LOW_QUEUE_MINUTES = 45;

export function shouldAutoHarvestBeforePublish(input: {
  now?: Date;
  activeFeedCount: number;
  lastFeedFetchedAt: Date | null;
  imageEligibleEntertainment: number;
  entertainmentConfigured: boolean;
  harvestEveryHours?: number;
}): { shouldHarvest: boolean; reason: string | null } {
  if (input.activeFeedCount <= 0) return { shouldHarvest: false, reason: null };
  const nowMs = (input.now ?? new Date()).getTime();
  const harvestEveryMs = (input.harvestEveryHours ?? PUBLISH_POLICY.harvestEveryHours) * 60 * 60 * 1000;
  if (!input.lastFeedFetchedAt) {
    return { shouldHarvest: true, reason: "feed-never-fetched" };
  }
  const ageMs = nowMs - input.lastFeedFetchedAt.getTime();
  if (ageMs >= harvestEveryMs) {
    return { shouldHarvest: true, reason: "feed-stale" };
  }
  if (
    input.entertainmentConfigured
    && input.imageEligibleEntertainment < POPBEEZ_ROUNDUP_MIN
    && ageMs >= AUTO_HARVEST_WHEN_LOW_QUEUE_MINUTES * 60 * 1000
  ) {
    return { shouldHarvest: true, reason: "roundup-needs-candidates" };
  }
  return { shouldHarvest: false, reason: null };
}

function diffMinutes(now: Date, past: Date | null): number | null {
  if (!past || Number.isNaN(past.getTime())) return null;
  return Math.max(0, Math.round((now.getTime() - past.getTime()) / 60_000));
}

export function assessAutomationHealth(input: AutomationHealthInput): AutomationHealthReport {
  const issues: AutomationIssue[] = [];
  const minutesSinceLastCron = diffMinutes(input.now, input.lastCronAt);
  const harvestRef = input.lastFeedFetchedAt && input.lastHarvestAt
    ? (input.lastFeedFetchedAt > input.lastHarvestAt ? input.lastFeedFetchedAt : input.lastHarvestAt)
    : (input.lastFeedFetchedAt ?? input.lastHarvestAt);
  const minutesSinceLastHarvest = diffMinutes(input.now, harvestRef);
  const minutesSinceLastPublish = diffMinutes(input.now, input.lastPublishedAt);
  const hoursSinceLastPublish = minutesSinceLastPublish === null
    ? null
    : Math.round((minutesSinceLastPublish / 60) * 10) / 10;

  if (
    input.appUrlHost
    && input.shortlinkOnlyHost
    && input.appUrlHost.toLowerCase() === input.shortlinkOnlyHost.toLowerCase()
  ) {
    issues.push({
      code: "shortlink-host-conflict",
      severity: "critical",
      title: "APP_URL bentrok dengan domain khusus shortlink",
      detail: `APP_URL memakai ${input.appUrlHost} yang diblokir middleware untuk /api/*. Arahkan APP_URL dan cron-job.org ke domain aplikasi utama (mis. https://portal-beez.vercel.app).`,
    });
  }

  if (input.activeFeedCount === 0) {
    issues.push({
      code: "no-active-feeds",
      severity: "critical",
      title: "Tidak ada feed RSS aktif",
      detail: "Aktifkan minimal satu sumber RSS di tab Feed RSS agar sistem punya bahan berita.",
    });
  } else if (minutesSinceLastHarvest === null) {
    issues.push({
      code: "rss-stale",
      severity: "critical",
      title: "RSS belum pernah dipanen",
      detail: "Belum ada catatan pengambilan RSS. Pastikan tugas cron-job.org memanggil GET/POST /api/harvest dengan header Authorization: Bearer <CRON_SECRET>, atau klik Panen RSS sekarang.",
    });
  } else if (minutesSinceLastHarvest > MAX_QUEUE_AGE_HOURS * 60) {
    const hours = Math.round((minutesSinceLastHarvest / 60) * 10) / 10;
    issues.push({
      code: "rss-stale",
      severity: "critical",
      title: `Panen RSS berhenti (${hours} jam lalu)`,
      detail: `RSS terakhir diambil ${hours} jam lalu, melewati batas kedaluwarsa antrean ${MAX_QUEUE_AGE_HOURS} jam sehingga antrean lama otomatis hangus. Periksa jadwal /api/harvest di cron-job.org.`,
    });
  } else if (minutesSinceLastHarvest > (PUBLISH_POLICY.harvestEveryHours + 1) * 60) {
    const hours = Math.round((minutesSinceLastHarvest / 60) * 10) / 10;
    issues.push({
      code: "rss-stale",
      severity: "warning",
      title: `Panen RSS terlambat (${hours} jam lalu)`,
      detail: `Jadwal ideal panen RSS setiap ${PUBLISH_POLICY.harvestEveryHours} jam, tetapi pengambilan terakhir ${hours} jam lalu.`,
    });
  }

  if (minutesSinceLastCron === null) {
    issues.push({
      code: "cron-missing",
      severity: "warning",
      title: "Belum ada detak /api/cron tercatat",
      detail: "Sistem pencatat baru aktif atau cron-job.org belum memanggil GET /api/cron. Jika dalam 15–20 menit tetap kosong, periksa tugas /api/cron di cron-job.org (pastikan memakai domain portal-beez.vercel.app dan header Authorization: Bearer <CRON_SECRET>).",
    });
  } else if (minutesSinceLastCron > 40) {
    issues.push({
      code: "cron-missing",
      severity: minutesSinceLastCron > 120 ? "critical" : "warning",
      title: `Pemicu /api/cron tidak berjalan (${minutesSinceLastCron} menit lalu)`,
      detail: `Endpoint /api/cron seharusnya dipanggil tiap 15 menit oleh cron-job.org, tetapi panggilan terakhir tercatat ${minutesSinceLastCron} menit lalu. Periksa apakah job di cron-job.org nonaktif (auto-disabled karena timeout/error) atau salah URL.`,
    });
  }

  if (hoursSinceLastPublish !== null && hoursSinceLastPublish >= 10) {
    const reason = input.queuedTotal === 0
      ? "antrean berita saat ini kosong (0 artikel)"
      : input.imageEligibleEntertainment < POPBEEZ_ROUNDUP_MIN
        ? `antrean Hiburan baru memiliki ${input.imageEligibleEntertainment}/${POPBEEZ_ROUNDUP_MIN} artikel bergambar layak`
        : input.failedArticlesLast24h > 0
          ? `ada ${input.failedArticlesLast24h} artikel gagal diproses dalam 24 jam terakhir`
          : "kemungkinan pemicu cron otomatis tidak memanggil /api/cron pada jam slot WITA";
    issues.push({
      code: "publish-stalled",
      severity: hoursSinceLastPublish >= 14 ? "critical" : "warning",
      title: `Belum ada posting baru selama ${hoursSinceLastPublish} jam`,
      detail: `Terakhir berhasil terbit ${hoursSinceLastPublish} jam lalu; penyebab utama saat ini: ${reason}.`,
    });
  }

  if (input.queuedEntertainment > 0 && input.imageEligibleEntertainment < POPBEEZ_ROUNDUP_MIN) {
    issues.push({
      code: "roundup-waiting-images",
      severity: "warning",
      title: `Antrean Hiburan menunggu 4 gambar (${input.imageEligibleEntertainment}/${POPBEEZ_ROUNDUP_MIN})`,
      detail: `Ada ${input.queuedEntertainment} artikel Hiburan di antrean, tetapi baru ${input.imageEligibleEntertainment} yang punya gambar layak untuk carousel 4 slide.`,
    });
  }

  if (input.failingFeedCount > 0) {
    issues.push({
      code: "feeds-failing",
      severity: input.failingFeedCount >= input.activeFeedCount && input.activeFeedCount > 0 ? "critical" : "warning",
      title: `${input.failingFeedCount} sumber RSS gagal diambil`,
      detail: "Sebagian sumber RSS mengembalikan error HTTP/timeout saat panen terakhir. Lihat rincian pesan error per feed di bawah.",
    });
  }

  if (input.failedArticlesLast24h > 0) {
    issues.push({
      code: "articles-failed",
      severity: "warning",
      title: `${input.failedArticlesLast24h} artikel gagal dalam 24 jam terakhir`,
      detail: "Periksa pesan error AI, penjaga orisinalitas, atau Graph API pada daftar artikel gagal di bawah.",
    });
  }

  if (input.recentAutomationErrors > 0) {
    issues.push({
      code: "automation-error",
      severity: "warning",
      title: `${input.recentAutomationErrors} eksekusi otomatis mencatat error`,
      detail: "Lihat riwayat log otomatis di bawah untuk detail kegagalan cron/harvest/AI/publikasi.",
    });
  }

  if (input.publisherLockedUntil && input.publisherLockedUntil.getTime() > input.now.getTime() + 60_000) {
    issues.push({
      code: "publisher-locked",
      severity: "warning",
      title: "Kunci publisher sedang aktif",
      detail: `Siklus publikasi dikunci hingga ${input.publisherLockedUntil.toISOString()} (maksimal 3 menit per siklus).`,
    });
  }

  const level: HealthLevel = issues.some((issue) => issue.severity === "critical")
    ? "critical"
    : issues.length > 0
      ? "warning"
      : "healthy";

  return {
    level,
    hoursSinceLastPublish,
    minutesSinceLastCron,
    minutesSinceLastHarvest,
    issues,
  };
}
