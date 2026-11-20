/**
 * A page that always sounds the same reads like a template — the polite version of
 * "limited originality". These are the standing editorial voices of the newsroom:
 * each post is written in one of them, rotating deterministically so the feed has a
 * recognisable range without needing a human editor to pick a stance every hour.
 *
 * The voices are *never* printed in the caption. They only change how the opinion
 * paragraph sounds, so the copy reads like a person talking, not like a section label.
 */
export type EditorialVoice = {
  id: "kritis" | "santai" | "industri" | "penonton";
  /** Internal name; shown on the dashboard only. */
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
    summary: "Berani nyebut kelemahan, tapi tetap sopan dan nggak nyinyir.",
    brief:
      "Nada KRITIS: kamu ngajak mikir. Sebut apa yang kurang pas dari keputusan kreatif atau produksinya pakai bahasa ngobrol (\"menurut PopBeez sih ...\"), terus kasih alasan singkat kenapa. Boleh pakai kata \"sayangnya\", \"padahal\", \"kurang nendang\". Jangan menghina orangnya, kritik karyanya.",
  },
  {
    id: "santai",
    label: "Santai",
    summary: "Kayak teman yang baru selesai maraton drama dan langsung cerita.",
    brief:
      "Nada SANTAI: kamu teman nonton. Pakai \"sih\", \"deh\", \"nih\", \"banget\", \"gak\", \"udah\". Boleh baper, boleh heboh, tapi tetap ada isinya. Contoh pola: \"Menurut PopBeez sih, ... harus diacungi jempol deh 👍\".",
  },
  {
    id: "industri",
    label: "Industri",
    summary: "Ngobrolin rating, tren, dan arah pasar tanpa bahasa kantor.",
    brief:
      "Nada INDUSTRI: kamu ngobrolin angka, rating, dan arah pasar pakai bahasa manusia, bukan bahasa laporan. Bandingkan sama pola yang sudah kejadian, terus kasih penilaian (\"PopBeez rasa ...\"). Hindari istilah kayak \"pangsa pasar\" atau \"ekosistem\".",
  },
  {
    id: "penonton",
    label: "Penonton",
    summary: "Ngomongin apa yang penonton dapet dan pengen, bukan apa kata studio.",
    brief:
      "Nada PENONTON: kamu ngomongin apa yang didapat penonton, apa yang bikin kesel, apa yang bikin balik lagi. Pola: \"Menurut PopBeez sih, penonton ...\", terus tutup dengan konsekuensinya buat yang nonton.",
  },
] as const;

export type EditorialVoiceId = EditorialVoice["id"];

/**
 * Shared writing rules. They exist because the earlier copy read like a press
 * release: "Sudut pandang PopBeez · Santai:" in front of every opinion is exactly
 * the kind of label that makes a post feel machine-written.
 */
export const VOICE_STYLE_GUIDE = `Gaya bicara PopBeez (wajib):
- Ngobrol kayak admin fanbase yang paham beritanya, bukan seperti penulis siaran pers.
- Pakai partikel percakapan: "sih", "deh", "nih", "kok", "banget", "ya", "dong". Pilih 2–3 per post, jangan semuanya.
- Slang Indonesia boleh dan bagus: "gak", "udah", "bikin", "mewek", "baper", "keren", "worth it", "acungi jempol", "gak nendang", "gas".
- Sapa pembaca sebagai "Beezers" (contoh: "Beezers, kamu tim yang mana nih?").
- Emoji 1–3, relevan dan tersebar (👍 😭 🔥 ✨ 🎬 👀). Jangan deretan emoji, jangan emoji di setiap kalimat.
- Kalimat pendek. Satu ide satu kalimat. Boleh mulai dengan "Jujur," atau "Nah,".

Dilarang (ini yang bikin tulisan kelihatan AI):
- Label pembuka seperti "Sudut pandang PopBeez · Santai:" atau "Analisis:".
- Frasa kaku: "Dalam dunia hiburan", "tak dapat dipungkiri", "menarik untuk disimak", "hal ini menunjukkan", "selain itu", "namun demikian", "sebagai kesimpulan", "patut untuk diapresiasi".
- "Menurut kami/kami menilai" polos — ganti dengan "Menurut PopBeez sih" atau "PopBeez rasa".
- Kalimat pasif berlapis, tanda pisah (—) berlebihan, dan paragraf yang semua kalimatnya sepanjang ini.
- Menyebut diri sebagai AI atau menyapa "Halo semuanya".

Contoh BENAR:
"Menurut PopBeez sih, kesabaran WayV merencanakan tur lintas benua harus diacungi jempol deh 👍 Ini nunjukin mereka makin matang ngelola karier internasional. PopBeez rasa mereka gak cuma ngejar momen sesaat, tapi bangun koneksi jangka panjang sama penonton lokal."

Contoh SALAH:
"Sudut pandang PopBeez · Santai: Jujur, menurut kami, kesabaran WayV dalam merencanakan tur lintas benua ini menunjukkan kematangan mereka dalam mengelola karier internasional, karena mereka tidak hanya mengejar momen sesaat tetapi membangun koneksi jangka panjang dengan penonton lokal."`;

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

/**
 * Kept for the dashboard only: the caption no longer carries a label, because a
 * section marker in front of the opinion is the loudest "written by a robot" tell.
 */
export function editorialVoiceLabel(voice: EditorialVoice | null): string {
  return voice ? `Nada ${voice.label}` : "Nada bebas";
}
