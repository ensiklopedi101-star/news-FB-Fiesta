/**
 * Content pillars classify stories deterministically. They can guide editorial
 * copy and provide a soft diversity preference when assembling PopBeez roundups;
 * they are not a per-day quota or a hard eligibility rule.
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
    share: "variasi fleksibel",
    reelsBoost: 2,
  },
  analysis: {
    id: "analysis",
    label: "Deep Dive",
    summary: "Analisis dan review spoiler-free: kenapa drama ini viral, bedah rating mingguan.",
    brief: "Pilar ANALISIS. Paragraf kedua wajib membedah sebab-akibat, perbandingan dengan karya lain, atau pola industri. Hindari spoiler; kalau perlu sebut batasnya. Opini harus punya argumen, bukan cuma pujian.",
    share: "variasi fleksibel",
    reelsBoost: 1,
  },
  relatable: {
    id: "relatable",
    label: "Relatable & POV",
    summary: "Meme, POV, ekspektasi vs realita, reaksi penonton.",
    brief: "Pilar RELATABLE. Nada paling santai: pakai perbandingan sehari-hari, POV penonton, atau ekspektasi vs realita. Boleh lebih banyak partikel dan 1 emoji. Tetap ada satu fakta nyata sebagai pijakan, jangan mengarang.",
    share: "variasi fleksibel",
    reelsBoost: 3,
  },
  list: {
    id: "list",
    label: "List & Ranking",
    summary: "Daftar dan peringkat: top drama, chart idol, rekomendasi webtoon.",
    brief: "Pilar DAFTAR/PERINGKAT. Sebut urutan atau kriterianya dengan jelas, jelaskan alasan singkat tiap poin yang dibahas, dan tutup dengan pertanyaan pilihan (\"menurut Beezers nomor satu siapa?\").",
    share: "variasi fleksibel",
    reelsBoost: 2,
  },
  community: {
    id: "community",
    label: "Community",
    summary: "Poll, Q&A, ajakan diskusi ringan seputar fandom.",
    brief: "Pilar KOMUNITAS. Fokusnya percakapan: pancing cerita atau pengalaman Beezers, bukan cuma like. Sebut pilihan jawaban biar gampang dibalas.",
    share: "variasi fleksibel",
    reelsBoost: 1,
  },
  manga: {
    id: "manga",
    label: "Manga",
    summary: "Kabar manga, chapter/volume baru, kreator, serialisasi, dan adaptasi komik.",
    brief: "Pilar MANGA. Utamakan informasi yang benar-benar ada di sumber—judul karya, kreator, status chapter/volume, jadwal, dan pengumuman. Jelaskan konteks singkat bagi pembaca, jangan mengarang spoiler atau tanggal rilis. Jika membahas beberapa judul, pisahkan tiap kabar dan sumbernya.",
    share: "variasi fleksibel",
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
