/**
 * Turns a spoken narration into Reel scenes. One sentence per frame keeps the
 * video readable without word-level timings: the durations are proportional to
 * the sentence length, and the renderer lets the audio decide the final cut.
 */
export type ReelScene = {
  /** Sentence shown on the frame, already cleaned for on-screen text. */
  text: string;
  /** Roughly how long this frame is visible. */
  seconds: number;
};

/** Indonesian TTS reads about 2.5 words per second; a little slower for clarity. */
const WORDS_PER_SECOND = 2.4;
const MIN_SCENE_SECONDS = 1.6;
const MAX_SCENES = 8;
/** Slack so the slideshow never ends before the audio does. */
const DURATION_SLACK = 1.12;

/** Emoji and symbols become tofu boxes in sharp/SVG text, so they are removed. */
const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

/** Cleans narration for speech: no markdown, URLs, hashtags, quotes, or emoji. */
export function toSpeechText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[\u201C\u201D"]/g, "")
    .replace(/[*_`~]/g, " ")
    .replace(EMOJI_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Splits narration into sentences without breaking on abbreviations or decimals.
 * A trailing fragment is merged into the previous sentence.
 */
export function splitSentences(value: string): string[] {
  const clean = toSpeechText(value);
  if (!clean) return [];
  const parts = clean
    .split(/(?<=[.!?])\s+(?=[A-Z0-9“"])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const part of parts) {
    const isFragment = part.split(/\s+/).length <= 3 && !/[.!?]$/.test(part);
    if (isFragment && merged.length) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${part}`.trim();
    } else {
      merged.push(part);
    }
  }
  return merged;
}

export function countWords(value: string): number {
  return toSpeechText(value).split(/\s+/).filter(Boolean).length;
}

/** Estimated spoken duration of a text, with a floor so a short line is readable. */
export function estimateSeconds(value: string): number {
  const seconds = countWords(value) / WORDS_PER_SECOND;
  return Math.max(MIN_SCENE_SECONDS, Number(seconds.toFixed(1)));
}

/** Long scenes are split so no single frame carries a whole paragraph. */
export function buildReelScenes(narration: string): ReelScene[] {
  const sentences = splitSentences(narration);
  const scenes: ReelScene[] = [];

  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= 22) {
      scenes.push({ text: sentence, seconds: estimateSeconds(sentence) });
      continue;
    }
    // Split a long sentence into readable chunks of at most 20 words.
    for (let index = 0; index < words.length; index += 20) {
      const chunk = words.slice(index, index + 20).join(" ");
      scenes.push({ text: chunk, seconds: estimateSeconds(chunk) });
    }
  }

  const trimmed = scenes.slice(0, MAX_SCENES);
  if (!trimmed.length) return [];
  return trimmed.map((scene) => ({ ...scene, seconds: Number((scene.seconds * DURATION_SLACK).toFixed(2)) }));
}

/** Total planned on-screen duration, used when no ffprobe is available. */
export function totalSeconds(scenes: ReelScene[]): number {
  return Number(scenes.reduce((total, scene) => total + scene.seconds, 0).toFixed(2));
}

/** Reels caption: the same substance as the post, plus the source note and IG handle. */
import { INSTAGRAM_HANDLE } from "@/lib/brand";

export function buildReelCaption(input: { headline: string; question: string; sourceName: string; hashtags?: string[] }): string {
  const hashtags = input.hashtags?.length ? input.hashtags.join(" ") : "#PopBeez #DramaKorea #FilmKorea";
  return [input.headline.trim(), "", input.question.trim(), "", hashtags, `📰 ${input.sourceName}`, "", `📱 Follow Instagram ${INSTAGRAM_HANDLE} juga ya, Beezers!`].join("\n");
}
