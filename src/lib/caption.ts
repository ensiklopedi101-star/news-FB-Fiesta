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
const ROUNDUP_NUMBER_EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣"];
const INDONESIAN_HEADLINE_MARKER = /\b(dan|yang|di|ke|dari|untuk|dengan|pada|dalam|oleh|saat|usai|jelang|resmi|gelar|umumkan|mengumumkan|raih|meraih|cetak|mencetak|tayang|perdana|terbaru|tertinggi|kesan\s+pertama|kemenangan|lagu|pembuka|penutup|pemeran|jadwal|rilis|tampil|sukses|pecahkan|rekor|tembus|ungkap|mengungkap|kembali|siap|bakal|jadi|bikin|lewat|hingga|tanpa)\b/i;
const ENGLISH_HEADLINE_MARKER = /^watch\s*:|\bfirst\s+impressions\b|\b(reveals?|unveils?|announces?|confirms?|teases?|soars?\s+to|takes?\s+\d+(?:st|nd|rd|th)\s+win|win\s+for|performances?\s+by|and\s+more|premiere\s+date|opening\s+theme(?:\s+song)?|ending\s+theme(?:\s+song)?|highest\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?ratings?|ratings?\s+yet|ahead\s+of|starring|shares?\s+(?:new|first|official)|drops?\s+(?:new|first|official))\b/i;

function normalizeHeadlineComparison(value: string): string {
  return value.replace(/[“”"‘’']/g, "\"").replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID");
}

/**
 * Flags roundup story headlines that were left in English instead of localized
 * into Indonesian, while keeping quoted or proper work titles intact.
 */
export function isUntranslatedRoundupHeadline(headline: string, originalTitle?: string): boolean {
  const trimmed = headline.trim();
  if (!trimmed) return true;
  const unquoted = trimmed
    .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ENGLISH_HEADLINE_MARKER.test(unquoted)) {
    return true;
  }
  if (!originalTitle?.trim()) return false;
  const normalizedHeadline = normalizeHeadlineComparison(trimmed);
  const normalizedOriginal = normalizeHeadlineComparison(originalTitle);
  const copiesOriginal = normalizedHeadline === normalizedOriginal
    || (normalizedHeadline.length >= 24 && normalizedOriginal.startsWith(normalizedHeadline));
  return copiesOriginal && !INDONESIAN_HEADLINE_MARKER.test(originalTitle);
}

export function formatRoundupStories(titles: string[], summaries: string[]): string[] {
  if (titles.length !== ROUNDUP_NUMBER_EMOJIS.length || titles.length !== summaries.length) {
    throw new Error("Roundup Feed harus berisi tepat empat judul dan empat ringkasan yang berpasangan.");
  }
  return titles.map((title, index) => `${ROUNDUP_NUMBER_EMOJIS[index]} **${normalizeBrand(title.trim())}**\n${normalizeBrand(summaries[index]!.trim())}`);
}

/** Fixed roundup layout keeps each summary directly under its matching headline. */
export function composeRoundupCaption(input: {
  title: string;
  titles: string[];
  summaries: string[];
  question: string;
  hashtags: string[];
}): string {
  const headline = input.title.replace(/^🔥\s*POPBEEZ ROUNDUP:\s*/i, "").trim();
  return [
    `🔥 POPBEEZ ROUNDUP: ${normalizeBrand(headline)}`,
    `Beezers, ada ${input.titles.length} kabar panas yang nggak boleh kamu lewatin hari ini! PopBeez sudah rangkum biar kamu tetap up-to-date:`,
    ...formatRoundupStories(input.titles, input.summaries),
    `💬 ${withAudience(normalizeBrand(input.question))}`,
    input.hashtags.join(" "),
  ].join("\n\n");
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
