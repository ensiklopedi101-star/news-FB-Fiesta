const GOOGLE_TRANSLATE_PAGE_URL = "https://translate.google.com/translate";

/** Returns a Google Translate page URL that opens the original article translated into Indonesian. */
export function indonesianTranslationUrl(sourceUrl: string): string {
  const translatedUrl = new URL(GOOGLE_TRANSLATE_PAGE_URL);
  translatedUrl.searchParams.set("sl", "auto");
  translatedUrl.searchParams.set("tl", "id");
  translatedUrl.searchParams.set("u", sourceUrl);
  return translatedUrl.toString();
}
