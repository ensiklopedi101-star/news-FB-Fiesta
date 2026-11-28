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

/** Editorial context belongs in natural prose, never under a robotic section label. */
const INDONESIAN_HEADLINE_MARKER = /\b(di|ke|dari|untuk|dengan|pada|dalam|oleh|saat|usai|jelang|lewat|hingga|tanpa|ini|itu|akan|sudah|telah|baru|resmi|tamat|raih|meraih|cetak|mencetak|tembus|menembus|masuk|daftar|puncaki|memuncaki|kuasai|menguasai|sapu|bersih|tayang|rilis|dirilis|umumkan|mengumumkan|ungkap|mengungkap|terungkap|perdana|terbaru|tertinggi|terpopuler|terlaris|kembali|siap|bakal|jadi|menjadi|bikin|sukses|pecahkan|memecahkan|rekor|kemenangan|peringkat|posisi|puncak|babak|akhir|kesan|pertama|kedua|ketiga|lagu|pembuka|penutup|jadwal|kisah|kasus|konser|bintang|bintangi|membintangi|pemeran|penonton|penggemar|heboh|ramai|sorotan|alasan|fakta|kabar|tampil|gelar|menggelar|tunda|menunda|ditunda|penundaan|akibat|lanjut|berlanjut|hadir|curi|perhatian|melesat|bertahan|unggul|dominasi|mendominasi|raup|meraup|catat|mencatat|tambah|menambah|tambahan|diadaptasi|musim|panggung|edisi|pekan|bulan|depan|aktor|aktris|tokoh|utama|peran|perankan|memerankan|siapkan|menyiapkan|tiket|ludes|habis|terjual|musik|cerita|karya|rilisan|pengumuman|tayangan|bab|dunia|tahun|minggu|hari|malam|setelah|sebelum|karena|namun|tapi|antara|bersama|kini|masih|makin|semakin|langsung|akhirnya|segera|tengah|sedang|mulai|kejutan|cuplikan|kunci|berjudul|bertajuk|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b|\b(?:me|di|ber|ter|pe|se)[a-z]{3,}(?:kan|nya)\b/i;
const ENGLISH_HEADLINE_MARKER = /^watch\s*:|\bfirst\s+impressions\b|\b(reveals?|unveils?|announces?|confirms?|teases?|ends?\s+in|sweeps?\b|top\s+spots?|dominates?|most\s+buzzworthy|rankings?|ranks?\s+on|bestseller\s+list|and\s+its\b|more\s+manga|soars?\s+to|takes?\s+\d+(?:st|nd|rd|th)\s+win|win\s+for|performances?\s+by|and\s+more|premiere\s+date|opening\s+theme(?:\s+song)?|ending\s+theme(?:\s+song)?|highest\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?ratings?|ratings?\s+yet|ahead\s+of|starring|joins?\b|new\s+(?:drama|film|movie|anime|series|season|trailer|album|single|song|poster|teaser)|shares?\s+(?:new|first|official)|drops?\s+(?:new|first|official))\b/i;

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&quot;": "\"",
      "&apos;": "'",
      "&lt;": "<",
      "&gt;": ">",
      "&nbsp;": " ",
    };
    const namedValue = named[entity.toLowerCase()];
    if (namedValue !== undefined) return namedValue;
    const numeric = entity.startsWith("&#x") || entity.startsWith("&#X")
      ? Number.parseInt(entity.slice(3, -1), 16)
      : Number.parseInt(entity.slice(2, -1), 10);
    return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff && !(numeric >= 0xd800 && numeric <= 0xdfff)
      ? String.fromCodePoint(numeric)
      : entity;
  });
}

export function stripMarkdownBold(text: string): string {
  return decodeHtmlEntities(text).replace(/\*+/g, "").replace(/\s+/g, " ").trim();
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
  if (titles.length !== 4 || titles.length !== summaries.length) {
    throw new Error("Roundup Feed harus berisi tepat empat judul dan empat ringkasan yang berpasangan.");
  }
  // Plain-text digits inherit Facebook's theme color; keycap emoji numerals can stay black in dark mode.
  return titles.map((title, index) => `${index + 1}. ${toFacebookBold(normalizeBrand(stripMarkdownBold(title)))}\n${normalizeBrand(summaries[index]!.replace(/\*+/g, "").trim())}`);
}

/** Fixed roundup layout keeps each informative summary directly under its headline. */
export function composeRoundupCaption(input: {
  title: string;
  titles: string[];
  summaries: string[];
  take?: string;
  question: string;
  hashtags: string[];
}): string {
  const headline = stripMarkdownBold(input.title.normalize("NFKC")).replace(/^🔥\s*POPBEEZ ROUNDUP:\s*/i, "").trim();
  const editorialLead = input.take?.trim()
    ? normalizeBrand(stripMarkdownBold(input.take))
    : "";
  return [
    `🔥 ${toFacebookBold(`POPBEEZ ROUNDUP: ${normalizeBrand(headline)}`)}`,
    ...(editorialLead ? [editorialLead] : []),
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
