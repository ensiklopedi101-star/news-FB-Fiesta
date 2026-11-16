import "server-only";
import { GoogleGenAI, Type } from "@google/genai";

const outputSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
    question: { type: Type.STRING },
  },
  required: ["title", "paragraphs", "question"],
} as const;

export type GeneratedCopy = { title: string; caption: string };

export async function writeNewsCopy(input: {
  title: string;
  rawText: string;
  category: string;
  sourceName: string;
}): Promise<GeneratedCopy> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY belum diatur.");
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const prompt = `Kamu editor berita berbahasa Indonesia. Buat ringkasan akurat dari materi sumber berikut untuk caption Facebook.

Aturan wajib:
- Terjemahkan ke bahasa Indonesia jika sumber berbahasa lain.
- Jangan menambah fakta, angka, kutipan, konteks, atau detail yang tidak ada di materi.
- Tulis judul ringkas dan menarik tanpa clickbait menyesatkan.
- Tulis tepat 3 paragraf pendek (masing-masing 1-2 kalimat, nyaman dibaca di ponsel).
- Akhiri dengan satu pertanyaan yang wajar untuk mengundang diskusi, tanpa mengarahkan jawaban.
- Hindari klaim bahwa berita sudah diverifikasi independen. Gunakan bahasa santai tetapi tetap netral.
- Output hanya sesuai JSON schema.

Kategori: ${input.category}
Nama sumber: ${input.sourceName}
Judul asli: ${input.title}
Isi dari feed RSS (mungkin hanya cuplikan):
${input.rawText || "Isi artikel tidak tersedia di RSS; gunakan hanya informasi pada judul dan jangan menebak."}`;

  const result = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: outputSchema, temperature: 0.35 },
  });
  const raw = result.text;
  if (!raw) throw new Error("Gemini tidak mengembalikan ringkasan.");

  let data: { title?: unknown; paragraphs?: unknown; question?: unknown };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("Respons Gemini bukan JSON yang valid.");
  }
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const paragraphs = Array.isArray(data.paragraphs)
    ? data.paragraphs.filter((part): part is string => typeof part === "string").map((part) => part.trim()).filter(Boolean).slice(0, 3)
    : [];
  const question = typeof data.question === "string" ? data.question.trim() : "";
  if (!title || paragraphs.length !== 3 || !question) {
    throw new Error("Hasil Gemini tidak memenuhi format judul, 3 paragraf, dan pertanyaan.");
  }
  return { title: title.slice(0, 180), caption: `${paragraphs.join("\n\n")}\n\n${question}` };
}
