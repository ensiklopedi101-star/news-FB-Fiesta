/**
 * Brand vocabulary. The entertainment page is **PopBeez** (capital B) on every
 * surface — cards, captions, quizzes, Reels, dashboard — and its readers are
 * **Beezers**, the name used whenever the copy speaks to the audience.
 */
export const BRAND_NEWS = "Nusabeez";
export const BRAND_ENTERTAINMENT = "PopBeez";
/** What we call the people reading, watching, and commenting. */
export const AUDIENCE_NAME = "Beezers";

/** Env override kept for white-label deploys; defaults to the PopBeez spelling. */
export function entertainmentBrand(env: Record<string, string | undefined> = process.env): string {
  return env.PAGE_BRAND_ENTERTAINMENT?.trim() || BRAND_ENTERTAINMENT;
}

export function brandFor(pageKey: "news" | "entertainment", env: Record<string, string | undefined> = process.env): string {
  if (pageKey === "news") return env.PAGE_BRAND_NEWS?.trim() || BRAND_NEWS;
  return entertainmentBrand(env);
}
