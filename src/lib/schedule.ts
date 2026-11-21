/**
 * Publication cadence.
 *
 * The page is four days old, so volume is the enemy: 93 posts in five days gave
 * every post roughly twenty minutes before the next one buried it. The cadence is
 * now editorial — three posts a day (pagi, sore, malam), a four-hour gap, and one
 * post per hour at most. Meta does not publish a "wait N minutes" rule; the point
 * is to give each post a clean first hour and to keep the data readable.
 */
export const PUBLISH_POLICY = {
  /** Hard cap per WITA calendar day, manual reviews excluded. */
  maxPerDay: 3,
  /** One post per hour so a slot never fires twice. */
  maxPerHour: 1,
  /** Pagi → sore → malam leaves room for the 4-hour gap. */
  minimumGapMinutes: 240,
  harvestEveryHours: 4,
  maxArticlesPerHarvest: 50,
} as const;

function envInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

/** Env-tunable view of the policy; defaults match the three-a-day cadence. */
export function publishPolicy(env: Record<string, string | undefined> = process.env): {
  maxPerDay: number;
  maxPerHour: number;
  minimumGapMinutes: number;
  harvestEveryHours: number;
  maxArticlesPerHarvest: number;
} {
  return {
    maxPerDay: envInt(env.PUBLISH_MAX_PER_DAY, PUBLISH_POLICY.maxPerDay, 1, 24),
    maxPerHour: envInt(env.PUBLISH_MAX_PER_HOUR, PUBLISH_POLICY.maxPerHour, 1, 12),
    minimumGapMinutes: envInt(env.PUBLISH_MIN_GAP_MINUTES, PUBLISH_POLICY.minimumGapMinutes, 0, 1_440),
    harvestEveryHours: PUBLISH_POLICY.harvestEveryHours,
    maxArticlesPerHarvest: PUBLISH_POLICY.maxArticlesPerHarvest,
  };
}

export const PUBLISH_LOCK_LEASE_MINUTES = 3;
