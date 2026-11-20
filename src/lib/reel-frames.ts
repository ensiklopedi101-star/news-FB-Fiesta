import { Buffer } from "node:buffer";
import sharp from "sharp";
import { ensureBundledFonts } from "@/lib/og-card";
import type { ReelScene } from "@/lib/reel-script";

/** Vertical Reels canvas. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

export type ReelFrameOptions = {
  brand: string;
  handle: string;
  voiceLabel: string;
  sourceName: string;
};

const EMOJI_PATTERN = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

/** Emoji would render as tofu boxes, so on-screen text drops them. */
function screenText(value: string): string {
  return value.replace(EMOJI_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function wrapWords(value: string, maxCharacters: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxCharacters) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Big sentence, sized down as it gets longer so it always fits the frame. */
function sentenceBlock(text: string): { lines: string[]; fontSize: number; lineHeight: number } {
  const length = text.length;
  if (length <= 70) return { lines: wrapWords(text, 22), fontSize: 78, lineHeight: 96 };
  if (length <= 120) return { lines: wrapWords(text, 26), fontSize: 66, lineHeight: 82 };
  if (length <= 190) return { lines: wrapWords(text, 30), fontSize: 56, lineHeight: 70 };
  return { lines: wrapWords(text, 34), fontSize: 48, lineHeight: 60 };
}

/** One 1080×1920 frame: brand lockup, the sentence, and the source footer. */
export async function renderReelFrame(scene: ReelScene, options: ReelFrameOptions, index: number): Promise<Buffer> {
  await ensureBundledFonts();
  const text = screenText(scene.text).slice(0, 260);
  const { lines, fontSize, lineHeight } = sentenceBlock(text);
  const blockHeight = lines.length * lineHeight;
  const startY = (REEL_HEIGHT - blockHeight) / 2 + lineHeight * 0.72;

  const body = lines.length
    ? lines
      .map((line, lineIndex) => `<text x="${REEL_WIDTH / 2}" y="${Math.round(startY + lineIndex * lineHeight)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="700" fill="#ffffff">${escapeXml(line)}</text>`)
      .join("")
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_WIDTH}" height="${REEL_HEIGHT}" viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#080d12"/>
        <stop offset="0.55" stop-color="#0d1a22"/>
        <stop offset="1" stop-color="#05080b"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#3ddc97"/>
        <stop offset="1" stop-color="#2b9c74"/>
      </linearGradient>
    </defs>
    <rect width="${REEL_WIDTH}" height="${REEL_HEIGHT}" fill="url(#bg)"/>
    <circle cx="${REEL_WIDTH - 90}" cy="180" r="320" fill="#3ddc97" fill-opacity="0.06"/>
    <rect x="0" y="0" width="${REEL_WIDTH}" height="10" fill="url(#accent)"/>

    <rect x="72" y="120" width="${Math.min(600, 34 + screenText(options.voiceLabel).length * 17)}" height="56" rx="28" fill="#ffffff" fill-opacity="0.10" stroke="#3ddc97" stroke-opacity="0.45" stroke-width="2"/>
    <text x="98" y="157" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="700" fill="#9ff0cd">${escapeXml(screenText(options.voiceLabel).slice(0, 32))}</text>
    <text x="${REEL_WIDTH - 72}" y="158" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="800" fill="#ffffff" fill-opacity="0.85">${escapeXml(options.brand.toUpperCase())}</text>

    ${body}

    <rect x="72" y="${REEL_HEIGHT - 250}" width="96" height="6" rx="3" fill="url(#accent)"/>
    <text x="72" y="${REEL_HEIGHT - 190}" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="700" fill="#ffffff" fill-opacity="0.78">${escapeXml(screenText(options.sourceName).slice(0, 40))}</text>
    <text x="72" y="${REEL_HEIGHT - 146}" font-family="DejaVu Sans, sans-serif" font-size="24" font-weight="600" fill="#7fe3bb" fill-opacity="0.9">${escapeXml(options.handle)}</text>
    <text x="${REEL_WIDTH - 72}" y="${REEL_HEIGHT - 146}" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="600" fill="#ffffff" fill-opacity="0.45">${index + 1}</text>
  </svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}
