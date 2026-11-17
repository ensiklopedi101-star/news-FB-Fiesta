export const MAX_QUEUE_AGE_HOURS = 7;
export const MAX_QUEUE_AGE_MS = MAX_QUEUE_AGE_HOURS * 60 * 60 * 1000;

export function getQueueExpiryCutoff(now = new Date()): Date {
  return new Date(now.getTime() - MAX_QUEUE_AGE_MS);
}

export function isQueueItemExpired(sourcePublishedAt: Date | null, now = new Date()): boolean {
  return sourcePublishedAt !== null && sourcePublishedAt.getTime() < getQueueExpiryCutoff(now).getTime();
}
