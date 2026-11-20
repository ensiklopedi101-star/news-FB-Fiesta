import { createReadOnlyJsonHandler, readApiJson, type createReadApiRateLimiter } from "./read-only-api";
import type { HealthSnapshot } from "./read-only-data";

type HealthDependencies = {
  loadSnapshot: (signal: AbortSignal) => Promise<HealthSnapshot>;
  getIntegrations: () => Record<string, boolean>;
  rateLimiter?: ReturnType<typeof createReadApiRateLimiter>;
  timeoutMs?: number;
};

export function createHealthHandler(dependencies: HealthDependencies) {
  const handler = createReadOnlyJsonHandler<undefined>(async (_request, _context, signal) => {
    let snapshot: HealthSnapshot;
    try {
      snapshot = await dependencies.loadSnapshot(signal);
    } catch {
      return readApiJson({ ok: false, database: "unavailable" }, 503);
    }
    return readApiJson({
      ...snapshot,
      integrations: {
        ...dependencies.getIntegrations(),
        feeds: snapshot.database === "connected" && snapshot.activeFeeds > 0,
      },
    }, snapshot.ok ? 200 : 503);
  }, {
    errorBody: (error) => ({ ok: false, error }),
    rateLimiter: dependencies.rateLimiter,
    timeoutMs: dependencies.timeoutMs,
  });
  return (request: Request) => handler(request, undefined);
}
