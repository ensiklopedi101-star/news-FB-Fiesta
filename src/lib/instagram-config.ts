/**
 * Pure Instagram configuration helpers. Kept out of `instagram.ts` so tests and the
 * dashboard can import them without pulling in the `server-only` publish client.
 */
function envValue(names: string[], env: Record<string, string | undefined> = process.env): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export const INSTAGRAM_USER_ID_ENV = ["IG_USER_ID", "INSTAGRAM_USER_ID"];
export const INSTAGRAM_TOKEN_ENV = ["IG_ACCESS_TOKEN", "INSTAGRAM_ACCESS_TOKEN", "FB_ENTERTAINMENT_PAGE_ACCESS_TOKEN"];

/** Which environment variables are still missing for Instagram publishing. */
export function getInstagramConfigurationGaps(env: Record<string, string | undefined> = process.env): string[] {
  const gaps: string[] = [];
  if (!envValue(INSTAGRAM_USER_ID_ENV, env)) gaps.push("IG_USER_ID");
  if (!envValue(INSTAGRAM_TOKEN_ENV, env)) gaps.push("IG_ACCESS_TOKEN");
  return gaps;
}

export function isInstagramPublishingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return getInstagramConfigurationGaps(env).length === 0;
}

export function instagramCredentials(env: Record<string, string | undefined> = process.env): { userId: string; token: string } | null {
  const userId = envValue(INSTAGRAM_USER_ID_ENV, env);
  const token = envValue(INSTAGRAM_TOKEN_ENV, env);
  return userId && token ? { userId, token } : null;
}
