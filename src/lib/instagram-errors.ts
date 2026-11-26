/**
 * Pure helpers for the Instagram Graph API error payloads, kept out of
 * `instagram.ts` so they can be unit-tested without `server-only`.
 *
 * The error that bit us in production is code **9007 / "Media ID is not
 * available"**: Meta has created the container but has not finished caching the
 * image yet, so `media_publish` is called too early. The fix is to poll the
 * container status and retry the publish instead of failing the whole post.
 */
export type GraphErrorPayload = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
};

export type GraphResponse = {
  id?: string;
  status_code?: string;
  status?: string;
  error?: GraphErrorPayload;
};

export class InstagramError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly fbtraceId?: string;

  constructor(message: string, payload: GraphErrorPayload = {}) {
    super(message);
    this.name = "InstagramError";
    this.code = payload.code;
    this.subcode = payload.error_subcode;
    this.fbtraceId = payload.fbtrace_id;
  }
}

/** Human hint for the codes Meta actually returns while publishing. */
export function instagramHintFor(code?: number): string {
  switch (code) {
    case 9007:
      return "Media belum siap di sisi Meta (code 9007). Biasanya karena publish dipanggil sebelum container FINISHED, atau URL gambar tidak bisa diunduh Meta.";
    case 190:
      return "Token kedaluwarsa atau tidak valid (code 190). Buat token halaman baru dan perbarui IG_ACCESS_TOKEN.";
    case 200:
    case 10:
      return "Izin kurang (code 200/10). Pastikan token punya instagram_basic + instagram_content_publish dan akun IG tertaut ke halaman Facebook.";
    case 4:
    case 17:
    case 32:
      return "Kena batas laju Instagram (code 4/17/32). Tunggu beberapa menit lalu coba lagi.";
    case 24:
      return "Media tidak bisa diunduh Meta (code 24). Pastikan URL gambar publik, JPEG, dan tidak butuh login.";
    case 100:
      return "Parameter tidak valid (code 100). Periksa IG_USER_ID — harus ID akun Instagram Business, bukan username atau ID halaman.";
    default:
      return "Periksa IG_USER_ID, IG_ACCESS_TOKEN, dan keterkaitan akun Instagram Business dengan halaman Facebook.";
  }
}

/** Strips the access token from anything we log or show in the dashboard. */
export function redactToken(value: string, token?: string): string {
  const withoutToken = token ? value.split(token).join("[REDACTED]") : value;
  return withoutToken.replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]");
}

export function formatGraphError(status: number, payload: GraphResponse, token?: string): InstagramError {
  const error = payload.error ?? {};
  const raw = error.message || error.error_user_msg || `HTTP ${status}`;
  const detail = redactToken(raw, token).slice(0, 300);
  const codeText = error.code ? ` (code ${error.code}${error.error_subcode ? `/${error.error_subcode}` : ""})` : "";
  return new InstagramError(`Instagram Graph API: ${detail}${codeText}. ${instagramHintFor(error.code)}`, error);
}

/** True when Meta created the container but is not ready to publish it yet. */
export function isMediaNotAvailable(error: unknown): boolean {
  if (!(error instanceof InstagramError)) return false;
  if (error.code === 9007) return true;
  return /media id is not available|media not ready|not finished/i.test(error.message);
}

/** Exponential-ish backoff used between publish retries: 4s, 8s, 12s. */
export function publishRetryDelayMs(attempt: number): number {
  return Math.min(4_000 * (attempt + 1), 15_000);
}

/** Container states Meta reports through `?fields=status_code`. */
export function containerState(status?: string): "ready" | "failed" | "pending" {
  const value = (status ?? "").toUpperCase();
  if (value === "FINISHED" || value === "PUBLISHED") return "ready";
  if (value === "ERROR" || value === "EXPIRED") return "failed";
  return "pending";
}
