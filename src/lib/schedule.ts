export const PUBLISH_POLICY = {
  maxPerHour: 2,
  minimumGapMinutes: 15,
  harvestEveryHours: 4,
  maxArticlesPerHarvest: 50,
} as const;

export const PUBLISH_LOCK_LEASE_MINUTES = 3;
