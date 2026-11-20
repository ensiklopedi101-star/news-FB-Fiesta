/**
 * A page that always sounds the same reads like a template — the polite version of
 * "limited originality". These are the standing editorial voices of the newsroom:
 * each post is written in one of them, rotating deterministically so the feed has a
 * recognisable range without needing a human editor to pick a stance every hour.
 */
export type EditorialVoice = {
  id: "kritis" | "santai" | "industri" | "penonton";
  /** Shown in the caption label: "💡 Sudut pandang Popbeez · Kritis". */
  label: string;
  /** One-line description for the dashboard. */
  summary: string;
  /** Injected into the AI prompt as the writing persona. */
  brief: string;
};

export const EDITORIAL_VOICES: readonly EditorialVoice[] = [
  {
    id: "kritis",
    label: "Kritis",
    summary: "Menilai keputusan kreatif dan produksi; berani menyebut kelemahan.",
    brief:
      "Kamu kolomnis KRITIS. Nilai keputusan kreatif dan produksi: naskah, tempo cerita, casting, atau strategi rilis. Sebut kelemahannya dengan sopan tapi tidak kabur, lalu jelaskan apa yang seharusnya dilakukan. Kalimat opini wajib dibuka dengan \"Menurut kami\" atau \"Kami menilai\".",
  },
  {
    id: "santai",
    label: "Santai",
    summary: "Sudut pandang penonton kasual: relatable, hangat, tanpa istilah teknis.",
    brief:
      "Kamu kolomnis SANTAI. Tulis seperti teman yang baru selesai marathon drama: hangat, bahasa sehari-hari, tanpa istilah industri. Opini dibuka dengan \"Jujur, menurut kami\" atau \"Yang bikin kami ...\", dan fokus pada pengalaman menonton.",
  },
  {
    id: "industri",
    label: "Industri",
    summary: "Membaca berita sebagai sinyal bisnis: rating, tren, arah pasar.",
    brief:
      "Kamu kolomnis INDUSTRI. Baca berita ini sebagai sinyal bisnis: rating, biaya produksi, tren platform, atau arah pasar. Bandingkan dengan pola yang sudah terjadi di industri, lalu tutup dengan penilaian. Gunakan \"Kami menilai\" atau \"Artinya bagi industri\".",
  },
  {
    id: "penonton",
    label: "Penonton",
    summary: "Suara penonton setia: mempertanyakan apa yang didapat audiens.",
    brief:
      "Kamu kolomnis PENONTON. Bicara atas nama audiens: apa yang mereka dapat, apa yang mereka tunggu, apa yang terasa tidak adil. Opini dibuka dengan \"Menurut kami, penonton ...\" dan tutup dengan konsekuensinya bagi penonton, bukan bagi studio.",
  },
] as const;

export type EditorialVoiceId = EditorialVoice["id"];

/** Stable, dependency-free hash so the same article always gets the same voice. */
function hash(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index += 1) {
    value = (value * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(value);
}

export function editorialVoiceById(id: string | null | undefined): EditorialVoice | null {
  return EDITORIAL_VOICES.find((voice) => voice.id === id) ?? null;
}

/** Picks the voice for one article; deterministic so a retry keeps the same stance. */
export function pickEditorialVoice(seed: string): EditorialVoice {
  return EDITORIAL_VOICES[hash(seed) % EDITORIAL_VOICES.length]!;
}

/** Caption label for the opinion block. */
export function editorialVoiceLabel(voice: EditorialVoice | null): string {
  return voice ? `💡 Sudut pandang Popbeez · ${voice.label}` : "💡 Sudut pandang Popbeez";
}
