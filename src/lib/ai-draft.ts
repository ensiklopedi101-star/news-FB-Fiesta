import { composeCaption, composeRoundupCaption, isUntranslatedRoundupHeadline, normalizeBrand, stripMarkdownBold } from "@/lib/caption";
import type { EditorialVoice } from "@/lib/editorial-voices";

export type ValidatedDraft = {
  title: string;
  caption: string;
  take: string;
  narration: string;
  voiceId: EditorialVoice["id"] | null;
  question: string;
  carouselSlides: string[];
  roundupTitles?: string[];
  roundupSummaries?: string[];
};

const GROQ_EXCLUDED_MODEL = /(?:guard|embed|whisper|tts|vision|audio|orpheus|playai|safeguard|allam|preview)/i;
const GEMINI_NON_TEXT_MODEL = /(?:image|tts|audio|embedding|aqa|robotics|live|computer-use|learnlm|veo|imagen)/i;

export const GROQ_DEFAULT_ROUNDUP_MAX_TOKENS = 850;
export const GROQ_DEFAULT_SINGLE_MAX_TOKENS = 700;
export const GEMINI_DEFAULT_ROUNDUP_MAX_TOKENS = 1_300;
export const GEMINI_DEFAULT_SINGLE_MAX_TOKENS = 900;
export const OPENROUTER_DEFAULT_ROUNDUP_MAX_TOKENS = 1_100;
export const OPENROUTER_DEFAULT_SINGLE_MAX_TOKENS = 850;

export function isGeminiTextModel(model: string): boolean {
  if (!/^gemini-.*(?:flash|lite)/i.test(model)) return false;
  if (/(?:preview|latest|exp)/i.test(model)) return false;
  if (/^gemini-(?:1\.0|1\.5|2\.0)-/i.test(model)) return false;
  if (GEMINI_NON_TEXT_MODEL.test(model)) return false;
  return true;
}

function geminiGenerationScore(model: string): number {
  const match = model.match(/^gemini-(\d+)(?:\.(\d+))?/i);
  if (!match) return 0;
  const major = Number(match[1] ?? 0);
  const minor = Number(match[2] ?? 0);
  return major * 10 + minor;
}

function groqModelPriority(model: string): number {
  const id = model.toLowerCase();
  if (id === "llama-3.3-70b-versatile") return 0;
  if (id === "llama-3.1-8b-instant") return 1;
  if (/llama-4.*scout|llama-3\.\d+.*instant/.test(id)) return 2;
  if (/^llama|^meta-llama\//.test(id)) return 3;
  if (/^gemma/.test(id)) return 4;
  if (/^qwen/.test(id) && /\b(?:7b|8b|14b|32b)\b/.test(id)) return 5;
  if (/^qwen/.test(id)) return 6;
  return 7;
}

export function rankGroqModels(availableIds: string[], preferred?: string): string[] {
  const available = new Set(availableIds.filter(Boolean));
  const candidates = [...available]
    .filter((id) => /^(?:llama|meta-llama\/|qwen|gemma|deepseek)/i.test(id) && !GROQ_EXCLUDED_MODEL.test(id))
    .sort((left, right) => groqModelPriority(left) - groqModelPriority(right));
  const cleanPreferred = preferred?.trim();
  const ordered = [
    ...(cleanPreferred && available.has(cleanPreferred) ? [cleanPreferred] : []),
    ...candidates,
  ];
  return [...new Set(ordered)];
}

export function rankGeminiModels(availableNames: string[], preferred?: string): string[] {
  const normalized = availableNames
    .map((name) => name.replace(/^models\//, "").trim())
    .filter(Boolean);
  const available = new Set(normalized);
  const candidates = [...available]
    .filter(isGeminiTextModel)
    .sort((left, right) => {
      const genDiff = geminiGenerationScore(right) - geminiGenerationScore(left);
      if (genDiff !== 0) return genDiff;
      // Within the same generation family, prefer fast/economical flash-lite before full flash.
      const leftLite = /lite/i.test(left) ? 0 : 1;
      const rightLite = /lite/i.test(right) ? 0 : 1;
      return leftLite - rightLite;
    });
  const cleanPreferred = preferred?.trim().replace(/^models\//, "");
  const ordered = [
    ...(cleanPreferred && available.has(cleanPreferred) && isGeminiTextModel(cleanPreferred) ? [cleanPreferred] : []),
    ...candidates,
  ];
  return [...new Set(ordered)];
}

const OPENROUTER_EXCLUDED_MODEL = /(?:guard|embed|whisper|tts|audio|vl\b|vision-only|image|coder|math|prover|moderation)/i;

function openRouterModelPriority(model: string): number {
  const id = model.toLowerCase();
  if (/llama-3\.3-70b-instruct:free/.test(id)) return 0;
  if (/gemma-3-27b-it:free/.test(id)) return 1;
  if (/mistral-small.*:free/.test(id)) return 2;
  if (/llama-4.*:free|llama-3\.\d+.*instruct:free/.test(id)) return 3;
  if (/qwen.*(?:32b|72b).*instruct:free|qwen3-(?:14b|30b|32b).*:free/.test(id)) return 4;
  if (id === "openrouter/free") return 5;
  if (/(?:llama|gemma|mistral|qwen).*:free$/.test(id)) return 6;
  return 7;
}

/**
 * Selects only zero-cost OpenRouter models (`:free` or `openrouter/free`), even
 * when an operator sets `OPENROUTER_MODEL`, ordered for Indonesian editorial JSON reliability.
 */
export function rankOpenRouterFreeModels(availableIds: string[], preferred?: string): string[] {
  const normalized = availableIds.map((id) => id.trim()).filter(Boolean);
  const available = new Set(normalized);
  const isFreeModel = (id: string) => id.endsWith(":free") || id === "openrouter/free";
  const candidates = [...available]
    .filter((id) => isFreeModel(id) && !OPENROUTER_EXCLUDED_MODEL.test(id))
    .sort((left, right) => openRouterModelPriority(left) - openRouterModelPriority(right));
  const cleanPreferred = preferred?.trim();
  const ordered = [
    ...(cleanPreferred && isFreeModel(cleanPreferred) && !OPENROUTER_EXCLUDED_MODEL.test(cleanPreferred)
      && (available.size === 0 || available.has(cleanPreferred) || cleanPreferred === "openrouter/free")
      ? [cleanPreferred]
      : []),
    ...candidates,
    "openrouter/free",
  ];
  return [...new Set(ordered)];
}

/**
 * Parses Groq OTPM rate-limit errors such as:
 * `Limit 1000, Requested 1600` and rate-limit errors containing `Used 244, Requested 850`,
 * returning a safe `max_tokens` value below the currently available OTPM capacity.
 */
export function parseGroqOtpmSafeTokens(errorMessage: string): number | null {
  const usageMatch = errorMessage.match(/Limit\s+(\d+)\s*,\s*Used\s+(\d+)\s*,\s*Requested\s+(\d+)/i);
  if (usageMatch) {
    const limit = Number(usageMatch[1]);
    const used = Number(usageMatch[2]);
    const requested = Number(usageMatch[3]);
    const safeRemaining = limit - used - 80;
    if (
      !Number.isFinite(limit)
      || !Number.isFinite(used)
      || !Number.isFinite(requested)
      || limit < 350
      || used < 0
      || requested < 1
      || safeRemaining < 350
    ) {
      return null;
    }
    return Math.min(limit - 80, safeRemaining);
  }

  const match = errorMessage.match(/output tokens per minute\s*\(OTPM\)\s*:\s*Limit\s+(\d+)\s*,\s*Requested\s+(\d+)/i)
    ?? errorMessage.match(/Limit\s+(\d+)\s*,\s*Requested\s+(\d+)/i);
  if (!match) return null;
  const limit = Number(match[1]);
  const requested = Number(match[2]);
  if (!Number.isFinite(limit) || !Number.isFinite(requested) || limit < 350 || limit >= requested) {
    return null;
  }
  return Math.max(350, limit - 80);
}

/** Strips `<think>...</think>`, markdown code fences, and surrounding prose around a JSON object. */
export function extractJsonText(raw: string): string {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    cleaned = fenced[1].trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export function clampAtBoundary(text: string, maxChars: number, suffix = ""): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  const limit = Math.max(12, maxChars - suffix.length);
  const slice = normalized.slice(0, limit + 1);
  // Prefer sentence end if near the target, otherwise last space.
  const sentenceEnd = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentenceEnd >= Math.floor(limit * 0.65)) {
    return `${slice.slice(0, sentenceEnd + 1).trim()}`;
  }
  const wordEnd = slice.lastIndexOf(" ");
  const cut = wordEnd >= Math.floor(limit * 0.5) ? slice.slice(0, wordEnd) : slice.slice(0, limit);
  return `${cut.replace(/[,:;—–\-\s]+$/g, "").trim()}${suffix}`;
}

function normalizeHashtag(value: string): string | null {
  const tag = value.trim().replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 40);
  return tag.length >= 2 ? `#${tag}` : null;
}

function uniqueHashtags(candidates: Array<string | null | undefined>, targetCount: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of candidates) {
    if (!raw) continue;
    const normalized = normalizeHashtag(raw);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase("id-ID");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= targetCount) break;
  }
  return result;
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => stripMarkdownBold(item))
    .filter(Boolean);
}

type RawDraftShape = {
  title?: unknown;
  paragraphs?: unknown;
  take?: unknown;
  narration?: unknown;
  question?: unknown;
  slidePoints?: unknown;
  roundupTitles?: unknown;
  titles?: unknown;
  headlines?: unknown;
  roundupSummaries?: unknown;
  summaries?: unknown;
  hashtags?: unknown;
};

export function validateAndRepairDraft(
  raw: string,
  input: {
    voice?: EditorialVoice;
    roundupCount?: number;
    originalTitles?: string[];
    category?: string;
  } = {},
): ValidatedDraft {
  let data: RawDraftShape;
  try {
    data = JSON.parse(extractJsonText(raw)) as RawDraftShape;
  } catch {
    throw new Error("Respons AI bukan JSON yang valid.");
  }

  const rawTitle = typeof data.title === "string" ? stripMarkdownBold(data.title) : "";
  const title = clampAtBoundary(rawTitle, 180);
  if (!title) {
    throw new Error("Validasi draf AI gagal: field title kosong.");
  }

  const rawQuestion = typeof data.question === "string" ? stripMarkdownBold(data.question) : "";
  const isRoundup = input.roundupCount !== undefined;

  if (isRoundup) {
    const expected = input.roundupCount!;
    const rawRoundupTitles = pickStringArray(data.roundupTitles ?? data.titles ?? data.headlines);
    const rawRoundupSummaries = pickStringArray(data.roundupSummaries ?? data.summaries);

    if (rawRoundupTitles.length !== expected) {
      throw new Error(`Validasi draf AI gagal: roundupTitles berisi ${rawRoundupTitles.length} dari ${expected} item.`);
    }
    if (rawRoundupSummaries.length !== expected) {
      throw new Error(`Validasi draf AI gagal: roundupSummaries berisi ${rawRoundupSummaries.length} dari ${expected} item.`);
    }

    const roundupTitles = rawRoundupTitles.map((item) => clampAtBoundary(item, 105));
    for (let index = 0; index < expected; index += 1) {
      const headline = roundupTitles[index]!;
      if (!headline || isUntranslatedRoundupHeadline(headline, input.originalTitles?.[index])) {
        throw new Error(`Validasi draf AI gagal: roundupTitles[${index + 1}] belum berbahasa Indonesia ("${headline.slice(0, 60)}").`);
      }
    }

    const roundupSummaries = rawRoundupSummaries.map((item) => clampAtBoundary(item.replace(/https?:\/\/\S+/g, ""), 360, "…"));
    if (roundupSummaries.some((summary) => summary.length < 45)) {
      throw new Error("Validasi draf AI gagal: salah satu roundupSummaries terlalu pendek untuk memberi konteks.");
    }

    let question = rawQuestion || `Dari ${expected} kabar ini, mana yang paling bikin kamu antusias?`;
    question = clampAtBoundary(question, 118, "?");
    if (!question.endsWith("?")) question = `${question.replace(/[.!…]+$/g, "").trim()}?`;

    const rawTake = typeof data.take === "string"
      ? stripMarkdownBold(data.take.replace(/https?:\/\/\S+/g, ""))
      : "";
    if (rawTake.length < 55) {
      throw new Error("Validasi draf AI gagal: pengantar editorial roundup kurang memberi sudut pandang.");
    }
    const spokenTake = normalizeBrand(clampAtBoundary(rawTake, 220));

    const rawNarration = typeof data.narration === "string"
      ? stripMarkdownBold(data.narration.replace(/https?:\/\/\S+/g, ""))
      : "";
    const fallbackNarration = `Beezers, ini rangkuman cepat PopBeez hari ini: ${roundupTitles.join(". ")}. Menurut PopBeez, kabar-kabar ini paling ramai dibahas pekan ini. ${question}`;
    const narration = normalizeBrand(
      clampAtBoundary(rawNarration.length >= 70 ? rawNarration : fallbackNarration, 880),
    );

    const rawTags = Array.isArray(data.hashtags)
      ? data.hashtags.filter((item): item is string => typeof item === "string")
      : [];
    const categoryTag = input.category ? `#${input.category.replace(/[^\p{L}\p{N}_]/gu, "")}` : null;
    const hashtags = uniqueHashtags(
      ["#PopBeezRoundup", ...rawTags, categoryTag, "#PopBeez", "#UpdateHiburan", "#KabarHiburan", "#InfoHiburan"],
      6,
    );
    if (hashtags.length < 6) {
      throw new Error(`Validasi draf AI gagal: hanya menghasilkan ${hashtags.length} dari 6 hashtag.`);
    }

    const caption = composeRoundupCaption({
      title,
      titles: roundupTitles,
      summaries: roundupSummaries,
      take: spokenTake,
      question,
      hashtags,
    });

    return {
      title: normalizeBrand(title),
      caption,
      take: spokenTake,
      narration,
      voiceId: input.voice?.id ?? null,
      question,
      carouselSlides: roundupSummaries,
      roundupTitles,
      roundupSummaries,
    };
  }

  // Single-article mode
  const paragraphs = pickStringArray(data.paragraphs).slice(0, 2);
  if (paragraphs.length !== 2) {
    throw new Error(`Validasi draf AI gagal: paragraphs berisi ${paragraphs.length} dari 2 paragraf.`);
  }

  const rawTake = typeof data.take === "string" ? stripMarkdownBold(data.take) : "";
  if (rawTake.length < 35) {
    throw new Error("Validasi draf AI gagal: opini redaksi (take) kurang dari 35 karakter.");
  }

  if (!rawQuestion) {
    throw new Error("Validasi draf AI gagal: pertanyaan diskusi (question) kosong.");
  }
  let question = clampAtBoundary(rawQuestion, 118, "?");
  if (!question.endsWith("?")) question = `${question.replace(/[.!…]+$/g, "").trim()}?`;

  const rawSlides = pickStringArray(data.slidePoints).slice(0, 2);
  const slidePoints = (rawSlides.length === 2 ? rawSlides : [paragraphs[0]!, paragraphs[1]!])
    .map((point) => clampAtBoundary(point, 120, "…"));

  const rawNarration = typeof data.narration === "string"
    ? stripMarkdownBold(data.narration.replace(/https?:\/\/\S+/g, ""))
    : "";
  const fallbackSingleNarration = `Beezers, ada kabar menarik nih: ${paragraphs[0]} ${rawTake} ${question}`;
  const narration = normalizeBrand(
    clampAtBoundary(rawNarration.length >= 70 ? rawNarration : fallbackSingleNarration, 880),
  );

  const rawTags = Array.isArray(data.hashtags)
    ? data.hashtags.filter((item): item is string => typeof item === "string")
    : [];
  const categoryTag = input.category ? `#${input.category.replace(/[^\p{L}\p{N}_]/gu, "")}` : null;
  const hashtags = uniqueHashtags([...rawTags, categoryTag, "#PopBeez", "#UpdateBerita"], 3);
  if (hashtags.length < 3) {
    throw new Error(`Validasi draf AI gagal: hanya menghasilkan ${hashtags.length} dari 3 hashtag.`);
  }

  const spokenTake = normalizeBrand(rawTake);
  const caption = composeCaption({
    paragraphs: [paragraphs[0]!, paragraphs[1]!],
    take: spokenTake,
    question,
    hashtags,
  });

  return {
    title: normalizeBrand(title),
    caption,
    take: spokenTake,
    narration,
    voiceId: input.voice?.id ?? null,
    question,
    carouselSlides: [slidePoints[0]!, slidePoints[1]!, question],
  };
}
