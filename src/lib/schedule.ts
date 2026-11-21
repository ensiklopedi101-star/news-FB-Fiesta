/**
 * Publication cadence. Four planned Feed slots balance freshness with a measured
 * publishing rhythm; this is an editorial experiment, not a guaranteed Meta rule.
 */
export const PUBLISH_POLICY = {
  /** Hard cap per WITA calendar day, manual reviews excluded. */
  maxPerDay: 4,
  /** One post per hour so a slot never fires twice. */
  maxPerHour: 1,
  /** The closest default slots are 3.5 hours apart. */
  minimumGapMinutes: 210,
  harvestEveryHours: 4,
  maxArticlesPerHarvest: 50,
} as const;

function envInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), min), max);
}

/** Env-tunable view of the policy; defaults match the four-a-day cadence. */
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
