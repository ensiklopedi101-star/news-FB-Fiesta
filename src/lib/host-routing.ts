export const DEFAULT_SHORTLINK_ONLY_HOST = "popbeez.hivecomp.my.id";

/** Host that may only serve /s/<slug>; set SHORTLINK_ONLY_HOST=off to disable the restriction. */
export function shortlinkOnlyHost(): string | null {
  const configured = process.env.SHORTLINK_ONLY_HOST?.trim().toLowerCase();
  if (configured === "off") return null;
  return configured || DEFAULT_SHORTLINK_ONLY_HOST;
}

export function isShortlinkPath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/");
}

/** True when the request targets the short-link host on any path other than /s/<slug>. */
export function shouldBlockForShortlinkHost(host: string | null | undefined, pathname: string): boolean {
  const allowedHost = shortlinkOnlyHost();
  if (!allowedHost || !host) return false;
  const normalized = host.split(":")[0]!.trim().toLowerCase();
  if (normalized !== allowedHost && normalized !== `www.${allowedHost}`) return false;
  return !isShortlinkPath(pathname);
}
