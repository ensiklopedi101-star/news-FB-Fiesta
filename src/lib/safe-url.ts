/**
 * Feed services like rss.app put their own artwork into an item's image fields. Those
 * pictures are never the article's photo, so the whole service is blocked instead of
 * matching one filename (the placeholder has changed shape twice already).
 */
const AGGREGATOR_HOSTS = ["rss.app", "rssapp.com", "rss.app-cdn.com"];

export function isKnownAggregatorBrandImage(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    if (AGGREGATOR_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return true;
    // Some readers proxy the placeholder from their own CDN.
    return /(?:^|[\/_.-])rss[-_.]?app(?:[\/_.-]|$)/i.test(decodeURIComponent(`${url.pathname}${url.search}`));
  } catch {
    return false;
  }
}

export function isSafePublicImageUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (url.port && url.port !== "443") return false;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost")) return false;
    if (hostname.includes(":")) return false; // Tolak literal IPv6 supaya tidak memanggil alamat lokal/link-local.
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [a, b] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 198 && (b === 18 || b === 19)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
