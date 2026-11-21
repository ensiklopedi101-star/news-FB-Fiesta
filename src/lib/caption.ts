import { AUDIENCE_NAME, BRAND_ENTERTAINMENT } from "@/lib/brand";

/** Brand spelling is enforced on the copy we publish, whatever the model returns. */
export function normalizeBrand(text: string): string {
  return text.replace(/popbeez/gi, BRAND_ENTERTAINMENT);
}

/**
 * The audience name is not left to chance: if the model forgets "Beezers", the
 * question is addressed to them anyway instead of failing the whole draft.
 */
export function withAudience(question: string): string {
  const clean = question.trim();
  if (!clean || new RegExp(AUDIENCE_NAME, "i").test(clean)) return clean;
  const lowered = clean.charAt(0).toLocaleLowerCase("id-ID") + clean.slice(1);
  return `${AUDIENCE_NAME}, ${lowered}`;
}

/**
 * Final caption: paragraph, paragraph, opinion, question, hashtags — no section
 * label. "Sudut pandang PopBeez · Santai:" in front of the opinion is the loudest
 * robot tell, so the opinion just continues the same voice.
 */
export function formatRoundupStories(titles: string[], summaries: string[]): string[] {
  if (!titles.length || titles.length !== summaries.length) throw new Error("Judul dan ringkasan roundup harus memiliki jumlah yang sama.");
  return titles.map((title, index) => `${index + 1}. ${normalizeBrand(title.trim())} — ${normalizeBrand(summaries[index]!.trim())}`);
}

export function composeCaption(input: {
  paragraphs: [string, string];
  take: string;
  question: string;
  hashtags: string[];
}): string {
  return [
    normalizeBrand(input.paragraphs[0]),
    normalizeBrand(input.paragraphs[1]),
    normalizeBrand(input.take),
    withAudience(normalizeBrand(input.question)),
    input.hashtags.join(" "),
  ].join("\n\n");
}
