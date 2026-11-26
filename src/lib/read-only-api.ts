export const READ_API_RATE_LIMIT = 60;
export const READ_API_RATE_WINDOW_MS = 60_000;
export const READ_API_TIMEOUT_MS = 1_500;
const MAX_RATE_LIMIT_KEYS = 10_000;

type RateLimitEntry = { count: number; resetAt: number };
export type ReadApiRateLimit = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfter: number;
};

// Best-effort, per-process protection. Use an ingress/firewall rate limit as well
// when running multiple replicas or serverless instances (see docs/hivecomp-api.md).
export function createReadApiRateLimiter(
  limit = READ_API_RATE_LIMIT,
  windowMs = READ_API_RATE_WINDOW_MS,
  now: () => number = Date.now,
) {
  const entries = new Map<string, RateLimitEntry>();
  let lastCleanupAt = 0;

  return (key: string): ReadApiRateLimit => {
    const currentTime = now();
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= currentTime) {
      if (entries.size >= MAX_RATE_LIMIT_KEYS && currentTime - lastCleanupAt >= 1_000) {
        for (const [entryKey, value] of entries) {
          if (value.resetAt <= currentTime) entries.delete(entryKey);
        }
        lastCleanupAt = currentTime;
      }
      // Do not evict active counters: a flood of new keys must not reset limits.
      if (!entries.has(key) && entries.size >= MAX_RATE_LIMIT_KEYS) {
        return { allowed: false, limit, remaining: 0, retryAfter: Math.ceil(windowMs / 1_000) };
      }
      entry = { count: 0, resetAt: currentTime + windowMs };
      entries.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= limit,
      limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1_000)),
    };
  };
}

export function getClientRateLimitKey(headers: Headers): string {
  // Only trust these headers behind a proxy that overwrites them (e.g. Vercel).
  const realIp = headers.get("x-real-ip")?.trim();
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (realIp || forwardedFor || "unknown").slice(0, 128);
}

export function readApiJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Cache-Control")) responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { status, headers: responseHeaders });
}

async function withReadDeadline(
  read: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("Read deadline exceeded"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => read(controller.signal)), expired]);
  } finally {
    clearTimeout(timeout);
    // Also cancel sibling reads when a health/schema probe has already failed.
    controller.abort();
  }
}

type ReadApiOptions = {
  errorBody?: (error: string) => unknown;
  rateLimiter?: ReturnType<typeof createReadApiRateLimiter>;
  timeoutMs?: number;
};

// Route handlers deliberately share the same guards for GET and rejected methods.
// No framework-generated OPTIONS/405 HTML responses, redirects or CORS headers.
export function createReadOnlyJsonHandler<Context>(
  onGet: (request: Request, context: Context, signal: AbortSignal) => Promise<Response>,
  options: ReadApiOptions = {},
) {
  const rateLimiter = options.rateLimiter ?? createReadApiRateLimiter();
  const errorBody = options.errorBody ?? ((error: string) => ({ error }));

  return async (request: Request, context: Context): Promise<Response> => {
    const headers = new Headers();
    try {
      const rate = rateLimiter(getClientRateLimitKey(request.headers));
      headers.set("RateLimit-Limit", String(rate.limit));
      headers.set("RateLimit-Remaining", String(rate.remaining));
      // RateLimit-Reset is a delay in seconds, not a Unix timestamp.
      headers.set("RateLimit-Reset", String(rate.retryAfter));
      if (!rate.allowed) {
        headers.set("Retry-After", String(rate.retryAfter));
        return readApiJson(errorBody("too_many_requests"), 429, headers);
      }
      if (request.method !== "GET") {
        headers.set("Allow", "GET");
        return readApiJson(errorBody("method_not_allowed"), 405, headers);
      }
      const response = await withReadDeadline(
        (signal) => onGet(request, context, signal),
        options.timeoutMs ?? READ_API_TIMEOUT_MS,
      );
      headers.forEach((value, name) => response.headers.set(name, value));
      return response;
    } catch {
      // Do not log raw database/provider errors: they can contain URLs or secrets.
      console.error("[read-only-api] Read failed or exceeded its deadline.");
      return readApiJson(errorBody("internal_server_error"), 500, headers);
    }
  };
}
