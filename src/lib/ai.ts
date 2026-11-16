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
type GeneratedDraft = { title?: unknown; paragraphs?: unknown; question?: unknown };

function buildPrompt(input: {
  title: string;
  rawText: string;
  category: string;
  sourceName: string;
}): string {
  return `Kamu editor berita berbahasa Indonesia. Buat ringkasan akurat dari materi sumber berikut untuk caption Facebook.

Aturan wajib:
- Terjemahkan ke bahasa Indonesia jika sumber berbahasa lain.
- Jangan menambah fakta, angka, kutipan, konteks, atau detail yang tidak ada di materi.
- Tulis judul ringkas dan menarik tanpa clickbait menyesatkan.
- Tulis tepat 3 paragraf pendek (masing-masing 1-2 kalimat, nyaman dibaca di ponsel).
- Akhiri dengan satu pertanyaan yang wajar untuk mengundang diskusi, tanpa mengarahkan jawaban.
- Hindari klaim bahwa berita sudah diverifikasi independen. Gunakan bahasa santai tetapi tetap netral.
- Kembalikan hanya JSON valid dengan properti title (string), paragraphs (array berisi tepat 3 string), dan question (string).

Kategori: ${input.category}
Nama sumber: ${input.sourceName}
Judul asli: ${input.title}
Isi dari feed RSS (mungkin hanya cuplikan):
${input.rawText || "Isi artikel tidak tersedia di RSS; gunakan hanya informasi pada judul dan jangan menebak."}`;
}

function validateDraft(raw: string): GeneratedCopy {
  let data: GeneratedDraft;
  try {
    data = JSON.parse(raw) as GeneratedDraft;
  } catch {
    throw new Error("Respons AI bukan JSON yang valid.");
  }

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const paragraphs = Array.isArray(data.paragraphs)
    ? data.paragraphs.filter((part): part is string => typeof part === "string").map((part) => part.trim()).filter(Boolean).slice(0, 3)
    : [];
  const question = typeof data.question === "string" ? data.question.trim() : "";
  if (!title || paragraphs.length !== 3 || !question) {
    throw new Error("Hasil AI tidak memenuhi format judul, 3 paragraf, dan pertanyaan.");
  }

  return { title: title.slice(0, 180), caption: `${paragraphs.join("\n\n")}\n\n${question}` };
}

function safeError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : "Kesalahan tidak diketahui.";
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.slice(0, 300);
}

async function generateWithGemini(apiKey: string, prompt: string): Promise<GeneratedCopy> {
  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
    contents: prompt,
    config: { responseMimeType: "application/json", responseSchema: outputSchema, temperature: 0.35 },
  });
  if (!result.text) throw new Error("Gemini tidak mengembalikan ringkasan.");
  return validateDraft(result.text);
}

async function generateWithGroq(apiKey: string, prompt: string): Promise<GeneratedCopy> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "Ikuti instruksi pengguna dengan akurat dan kembalikan JSON saja." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.35,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  if (!response.ok) {
    throw new Error(data?.error?.message || `Groq API HTTP ${response.status}.`);
  }
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Groq tidak mengembalikan ringkasan.");
  return validateDraft(raw);
}

export async function writeNewsCopy(input: {
  title: string;
  rawText: string;
  category: string;
  sourceName: string;
}): Promise<GeneratedCopy> {
  const primaryKey = process.env.GEMINI_API_KEY?.trim();
  const fallbackKey = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const configuredKeys = [primaryKey, fallbackKey, groqKey].filter((key): key is string => Boolean(key));
  if (configuredKeys.length === 0) {
    throw new Error("Atur minimal GEMINI_API_KEY, GEMINI_API_KEY_FALLBACK, atau GROQ_API_KEY.");
  }

  const prompt = buildPrompt(input);
  const failures: string[] = [];
  const geminiProviders: Array<{ name: string; key: string }> = [];
  if (primaryKey) geminiProviders.push({ name: "Gemini utama", key: primaryKey });
  if (fallbackKey && fallbackKey !== primaryKey) geminiProviders.push({ name: "Gemini cadangan", key: fallbackKey });

  for (const provider of geminiProviders) {
    try {
      return await generateWithGemini(provider.key, prompt);
    } catch (error) {
      failures.push(`${provider.name}: ${safeError(error, configuredKeys)}`);
    }
  }

  if (groqKey) {
    try {
      return await generateWithGroq(groqKey, prompt);
    } catch (error) {
      failures.push(`Groq: ${safeError(error, configuredKeys)}`);
    }
  }

  throw new Error(`Semua penyedia AI gagal. ${failures.join(" | ")}`.slice(0, 950));
}
