/**
 * Content pillars keep the publisher's daily mix varied. Each article is classified
 * into one of six pillars, with at most `PILLAR_MAX_PER_DAY` posts from the same
 * pillar per WITA day, and no repeat in a row when an alternative is queued.
 *
 * The classification is deterministic keyword matching (no AI call, so it cannot
 * fail mid-publish) and is used both for the caption brief and for queue selection.
 */
export type Pillar = "breaking" | "analysis" | "relatable" | "list" | "community" | "manga";

export type PillarDefinition = {
  id: Pillar;
  label: string;
  /** One-line explanation for the dashboard. */
  summary: string;
  /** Extra direction appended to the AI prompt. */
  brief: string;
  /** Share of the content mix this pillar should fill. */
  share: string;
  /** Preferred for Reels (video formats win discovery). */
  reelsBoost: number;
};

export const PILLARS: Record<Pillar, PillarDefinition> = {
  breaking: {
    id: "breaking",
    label: "Breaking & Update",
    summary: "Kabar cepat: comeback, menang show champion, rating, pengumuman.",
    brief: "Pilar BERITA CEPAT. Tetap kasih satu fakta inti di depan, tapi nilai tambahnya adalah \"kenapa ini penting sekarang\" dan dampaknya buat Beezers. Jangan bertele-tele; pembaca butuh cepat.",
    share: "maks 1/hari",
    reelsBoost: 2,
  },
  analysis: {
    id: "analysis",
    label: "Deep Dive",
    summary: "Analisis dan review spoiler-free: kenapa drama ini viral, bedah rating mingguan.",
    brief: "Pilar ANALISIS. Paragraf kedua wajib membedah sebab-akibat, perbandingan dengan karya lain, atau pola industri. Hindari spoiler; kalau perlu sebut batasnya. Opini harus punya argumen, bukan cuma pujian.",
    share: "1/hari",
    reelsBoost: 1,
  },
  relatable: {
    id: "relatable",
    label: "Relatable & POV",
    summary: "Meme, POV, ekspektasi vs realita, reaksi penonton.",
    brief: "Pilar RELATABLE. Nada paling santai: pakai perbandingan sehari-hari, POV penonton, atau ekspektasi vs realita. Boleh lebih banyak partikel dan 1 emoji. Tetap ada satu fakta nyata sebagai pijakan, jangan mengarang.",
    share: "1/hari",
    reelsBoost: 3,
  },
  list: {
    id: "list",
    label: "List & Ranking",
    summary: "Daftar dan peringkat: top drama, chart idol, rekomendasi webtoon.",
    brief: "Pilar DAFTAR/PERINGKAT. Sebut urutan atau kriterianya dengan jelas, jelaskan alasan singkat tiap poin yang dibahas, dan tutup dengan pertanyaan pilihan (\"menurut Beezers nomor satu siapa?\").",
    share: "1/hari",
    reelsBoost: 2,
  },
  community: {
    id: "community",
    label: "Community",
    summary: "Poll, Q&A, ajakan diskusi ringan seputar fandom.",
    brief: "Pilar KOMUNITAS. Fokusnya percakapan: pancing cerita atau pengalaman Beezers, bukan cuma like. Sebut pilihan jawaban biar gampang dibalas.",
    share: "1/hari",
    reelsBoost: 1,
  },
  manga: {
    id: "manga",
    label: "Manga",
    summary: "Kabar manga, chapter/volume baru, kreator, serialisasi, dan adaptasi komik.",
    brief: "Pilar MANGA. Utamakan informasi yang benar-benar ada di sumber—judul karya, kreator, status chapter/volume, jadwal, dan pengumuman. Jelaskan konteks singkat bagi pembaca, jangan mengarang spoiler atau tanggal rilis. Jika membahas beberapa judul, pisahkan tiap kabar dan sumbernya.",
    share: "1/hari",
    reelsBoost: 2,
  },
};

export const PILLAR_IDS = Object.keys(PILLARS) as Pillar[];

export type PillarArticle = {
  title: string;
  category?: string | null;
};

const KEYWORDS: Array<{ pillar: Pillar; pattern: RegExp }> = [
  // Topic pillar wins over format labels: a ranked Manga roundup stays Manga.
  { pillar: "manga", pattern: /\b(manga|mangaka|komik|komikus|webtoon|manhwa|manhua|shonen jump|manga plus|mangaplus|tankobon)\b/i },
  { pillar: "list", pattern: /\b(top|best|ranking|ranked|peringkat|chart|daftar|rekomendasi|wajib nonton|terbaik|terpopuler|urutan)\b/i },
  { pillar: "relatable", pattern: /\b(pov|meme|relatable|ekspektasi|expectation|reality|kenyataan|reaction|reaksi|funny|lucu|ngakak|viral|receh)\b/i },
  { pillar: "community", pattern: /\b(poll|kuis|quiz|q&a|tanya jawab|diskusi|fandom|bias|vote|survey|menurut kamu)\b/i },
  { pillar: "analysis", pattern: /\b(review|analisis|analysis|kenapa|why|explained|bedah|recap|opini|editorial|deep dive|spoiler-?free)\b/i },
  { pillar: "breaking", pattern: /\b(comeback|debut|menang|win|juara|umumkan|announce|konfirmasi|rating|naik|turun|breakup|kencan|kontrak|hiatus|wamil|enlist|trailer|teaser)\b/i },
];

/**
 * Deterministic classification. Manga is checked before format signals so Manga
 * remains its own topic pillar even when the headline also says "top" or "ranking".
 */
export function classifyPillar(article: PillarArticle): Pillar {
  const haystack = `${article.title} ${article.category ?? ""}`.trim();
  for (const rule of KEYWORDS) {
    if (rule.pattern.test(haystack)) return rule.pillar;
  }
  // Nothing matched: this is routine news, which belongs in the update pillar.
  return "breaking";
}

export function pillarLabel(pillar: Pillar): string {
  return PILLARS[pillar]?.label ?? PILLARS.breaking.label;
}

/** Default cap per pillar per WITA day: one, so four daily posts draw from six pillars. */
export function pillarMaxPerDay(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.PILLAR_MAX_PER_DAY?.trim());
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(Math.round(parsed), 1), 12);
}

export function pillarQuotaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PILLARS_ENABLED?.trim() !== "0";
}

export type PillarCandidate = { id: string; pillar: Pillar | null | undefined };

/**
 * Picks the first candidate whose pillar still has room today and is not the same
 * pillar as the previous post. Falls back to the first candidate when every pillar
 * is capped (better to publish than to stall the queue), but never breaks the
 * "different from previous" rule unless that is the only option.
 */
export function selectByPillar<T extends PillarCandidate>(
  candidates: T[],
  options: { todayCounts: Partial<Record<Pillar, number>>; maxPerDay: number; previousPillar?: Pillar | null; enabled?: boolean },
): T | undefined {
  if (!candidates.length) return undefined;
  if (options.enabled === false) return candidates[0];

  const resolved = candidates.map((candidate) => ({
    candidate,
    pillar: candidate.pillar ?? classifyPillar({ title: "" }),
  }));
  const underCap = resolved.filter(({ pillar }) => (options.todayCounts[pillar] ?? 0) < options.maxPerDay);
  const pool = underCap.length ? underCap : resolved;
  const different = pool.find(({ pillar }) => pillar !== options.previousPillar);
  return (different ?? pool[0])?.candidate;
}
