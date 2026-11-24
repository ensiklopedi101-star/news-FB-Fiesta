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
const INDONESIAN_HEADLINE_MARKER = /\b(di|ke|dari|untuk|dengan|pada|dalam|oleh|saat|usai|jelang|lewat|hingga|tanpa|ini|itu|akan|sudah|telah|baru|resmi|tamat|raih|meraih|cetak|mencetak|tembus|menembus|masuk|daftar|puncaki|memuncaki|kuasai|menguasai|sapu|bersih|tayang|rilis|dirilis|umumkan|mengumumkan|ungkap|mengungkap|perdana|terbaru|tertinggi|terpopuler|terlaris|kembali|siap|bakal|jadi|menjadi|bikin|sukses|pecahkan|memecahkan|rekor|kemenangan|peringkat|posisi|puncak|babak|akhir|kesan|pertama|kedua|ketiga|lagu|pembuka|penutup|jadwal|kisah|kasus|konser|bintang|bintangi|membintangi|pemeran|penonton|penggemar|heboh|ramai|sorotan|alasan|fakta|kabar|tampil|gelar|menggelar|lanjut|berlanjut|hadir|curi|perhatian|melesat|bertahan|unggul|dominasi|mendominasi|raup|meraup|catat|mencatat|tambah|menambah|diadaptasi|musim|panggung|edisi|pekan|bulan|depan)\b/i;
const ENGLISH_HEADLINE_MARKER = /^watch\s*:|\bfirst\s+impressions\b|\b(reveals?|unveils?|announces?|confirms?|teases?|ends?\s+in|sweeps?\b|top\s+spots?|dominates?|most\s+buzzworthy|rankings?|ranks?\s+on|bestseller\s+list|and\s+its\b|more\s+manga|soars?\s+to|takes?\s+\d+(?:st|nd|rd|th)\s+win|win\s+for|performances?\s+by|and\s+more|premiere\s+date|opening\s+theme(?:\s+song)?|ending\s+theme(?:\s+song)?|highest\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?ratings?|ratings?\s+yet|ahead\s+of|starring|joins?\b|new\s+(?:drama|film|movie|anime|series|season|trailer|album|single|song|poster|teaser)|shares?\s+(?:new|first|official)|drops?\s+(?:new|first|official))\b/i;

export function stripMarkdownBold(text: string): string {
  return text.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Facebook Page posts do not parse Markdown `**bold**` and show raw asterisks.
 * Mathematical Sans-Serif Bold renders visually bold across Facebook web/mobile.
 */
export function toFacebookBold(text: string): string {
  const clean = text.normalize("NFKC").replace(/\*+/g, "");
  let result = "";
  for (const char of clean) {
    const code = char.codePointAt(0)!;
    if (code >= 0x41 && code <= 0x5a) {
      result += String.fromCodePoint(0x1d5d4 + (code - 0x41));
    } else if (code >= 0x61 && code <= 0x7a) {
      result += String.fromCodePoint(0x1d5ee + (code - 0x61));
    } else if (code >= 0x30 && code <= 0x39) {
      result += String.fromCodePoint(0x1d7ec + (code - 0x30));
    } else {
      result += char;
    }
  }
  return result;
}

function normalizeHeadlineComparison(value: string): string {
  return value.normalize("NFKC").replace(/\*+/g, "").replace(/[“”"‘’']/g, "\"").replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID");
}

/**
 * Flags roundup story headlines that were left in English instead of localized
 * into Indonesian, while keeping quoted or proper work titles intact.
 */
export function isUntranslatedRoundupHeadline(headline: string, originalTitle?: string): boolean {
  const trimmed = stripMarkdownBold(headline.normalize("NFKC"));
  if (!trimmed) return true;
  const unquoted = trimmed
    .replace(/“[^”]*”|"[^"]*"|‘[^’]*’|'[^']*'/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (ENGLISH_HEADLINE_MARKER.test(unquoted)) {
    return true;
  }
  if (!INDONESIAN_HEADLINE_MARKER.test(unquoted) && !/\byang\b/.test(unquoted)) {
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
  return titles.map((title, index) => `${ROUNDUP_NUMBER_EMOJIS[index]} ${toFacebookBold(normalizeBrand(stripMarkdownBold(title)))}\n${normalizeBrand( summaries[index]!.replace(/\*+/g, "").trim() )}`);
}

/** Fixed roundup layout keeps each summary directly under its matching headline. */
export function composeRoundupCaption(input: {
  title: string;
  titles: string[];
  summaries: string[];
  question: string;
  hashtags: string[];
}): string {
  const headline = stripMarkdownBold(input.title.normalize("NFKC")).replace(/^🔥\s*POPBEEZ ROUNDUP:\s*/i, "").trim();
  return [
    `🔥 ${toFacebookBold(`POPBEEZ ROUNDUP: ${normalizeBrand(headline)}`)}`,
    `Beezers, ada ${input.titles.length} kabar panas yang nggak boleh kamu lewatin hari ini! PopBeez sudah rangkum biar kamu tetap up-to-date:`,
    ...formatRoundupStories(input.titles, input.summaries),
    `💬 ${withAudience(normalizeBrand(stripMarkdownBold(input.question)))}`,
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
    normalizeBrand(input.paragraphs[0].replace(/\*+/g, "")),
    normalizeBrand(input.paragraphs[1].replace(/\*+/g, "")),
    normalizeBrand(input.take.replace(/\*+/g, "")),
    withAudience(normalizeBrand(input.question.replace(/\*+/g, ""))),
    input.hashtags.join(" "),
  ].join("\n\n");
}
