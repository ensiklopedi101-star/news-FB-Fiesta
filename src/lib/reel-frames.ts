import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { ensureBundledFonts } from "@/lib/og-card";
import { circularLogoBuffer } from "@/lib/logo-circle";
import { POWERED_BY } from "@/lib/brand";
import type { ReelScene } from "@/lib/reel-script";

/** Vertical Reels canvas. */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

/**
 * Reel palette follows the card palette: PopBeez pink, HIVECOMP yellow and the
 * near-black ink the news cards use, so a Reel and its feed card look like one brand.
 */
const PINK = "#f20b55";
const YELLOW = "#ffd12e";
const INK = "#08080a";

export type ReelFrameOptions = {
  brand: string;
  handle: string;
  /** Small tag on the frame; the audience name by default. */
  voiceLabel: string;
  sourceName: string;
  /** Shown as a quiet second handle so the Reel works on both apps. */
  facebookHandle?: string;
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

/** Usable text width between the frame gutters. */
const TEXT_WIDTH = REEL_WIDTH - 144;
/** DejaVu Sans Bold averages ~0.7 em per character; uppercase runs a little wider. */
const CHARACTER_EM = 0.72;
const MAX_BLOCK_HEIGHT = 880;

/**
 * Big sentence, sized down as it gets longer so it always fits the frame. Wrapping
 * and font size are derived from the same estimate, so a long uppercase headline can
 * never run past the gutter. Among the sizes that fit, the one with the fewest lines
 * wins, which keeps short hooks from breaking into three lonely lines.
 */
function sentenceBlock(text: string): { lines: string[]; fontSize: number; lineHeight: number } {
  const length = text.length;
  const base = length <= 70 ? 82 : length <= 120 ? 70 : length <= 190 ? 58 : 48;
  let best: { lines: string[]; fontSize: number } | undefined;
  for (let fontSize = base; fontSize >= 44; fontSize -= 4) {
    const charsPerLine = Math.max(12, Math.floor(TEXT_WIDTH / (fontSize * CHARACTER_EM)));
    const lines = wrapWords(text, charsPerLine);
    const widest = lines.reduce((widest, line) => Math.max(widest, line.length), 0);
    const fits = widest * fontSize * CHARACTER_EM <= TEXT_WIDTH
      && lines.length * fontSize * 1.2 <= MAX_BLOCK_HEIGHT;
    if (!fits) continue;
    if (!best || lines.length < best.lines.length) best = { lines, fontSize };
    if (lines.length <= 2) break;
  }
  if (!best) {
    const fontSize = 40;
    const charsPerLine = Math.max(12, Math.floor(TEXT_WIDTH / (fontSize * CHARACTER_EM)));
    best = { lines: wrapWords(text, charsPerLine), fontSize };
  }
  return { lines: best.lines, fontSize: best.fontSize, lineHeight: Math.round(best.fontSize * 1.2) };
}

const LOGO_SIZE = 108;
const logoCache = new Map<string, Promise<Buffer>>();

/** The page logo, always a real circle, cached per page. */
function reelLogo(brand: string): Promise<Buffer> {
  const file = brand.toLowerCase().includes("nusa") ? "nusabeez_icon.png" : "popbeez_icon.png";
  let pending = logoCache.get(file);
  if (!pending) {
    pending = readFile(resolve(process.cwd(), "public/brand", file))
      .then((buffer) => circularLogoBuffer(buffer, LOGO_SIZE));
    logoCache.set(file, pending);
  }
  return pending;
}

/**
 * One 1080×1920 frame: circular page logo, brand lockup, the sentence, the source
 * footer, and the HIVECOMP credit — the same brand furniture as the feed cards.
 */
export async function renderReelFrame(scene: ReelScene, options: ReelFrameOptions, index: number): Promise<Buffer> {
  await ensureBundledFonts();
  const text = screenText(scene.text).slice(0, 260);
  const { lines, fontSize, lineHeight } = sentenceBlock(text);
  const blockHeight = lines.length * lineHeight;
  // Sit the sentence slightly above centre so the footer never crowds it.
  const startY = (REEL_HEIGHT - blockHeight) / 2 - 40 + lineHeight * 0.72;

  const body = lines.length
    ? lines
      .map((line, lineIndex) => `<text x="${REEL_WIDTH / 2}" y="${Math.round(startY + lineIndex * lineHeight)}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff">${escapeXml(line)}</text>`)
      .join("")
    : "";

  const voiceLabel = screenText(options.voiceLabel).slice(0, 28) || "BEEZERS";
  const pillWidth = Math.min(430, 46 + voiceLabel.length * 15);
  const pillX = REEL_WIDTH - 72 - pillWidth;
  const brand = screenText(options.brand).toUpperCase().slice(0, 18);
  const facebookHandle = options.facebookHandle ? screenText(options.facebookHandle).slice(0, 34) : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_WIDTH}" height="${REEL_HEIGHT}" viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0" stop-color="${INK}"/>
        <stop offset="0.58" stop-color="#150810"/>
        <stop offset="1" stop-color="#050507"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${PINK}" stop-opacity="0.42"/>
        <stop offset="1" stop-color="${PINK}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="glow-yellow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${YELLOW}" stop-opacity="0.22"/>
        <stop offset="1" stop-color="${YELLOW}" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="brandbar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${PINK}"/>
        <stop offset="0.55" stop-color="${PINK}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${YELLOW}"/>
      </linearGradient>
    </defs>

    <rect width="${REEL_WIDTH}" height="${REEL_HEIGHT}" fill="url(#bg)"/>
    <circle cx="${REEL_WIDTH - 120}" cy="330" r="520" fill="url(#glow)"/>
    <circle cx="140" cy="${REEL_HEIGHT - 260}" r="420" fill="url(#glow-yellow)"/>
    <rect x="0" y="0" width="${REEL_WIDTH}" height="12" fill="url(#brandbar)"/>

    <text x="206" y="184" font-family="DejaVu Sans, sans-serif" font-size="46" font-weight="900" letter-spacing="1.5" fill="#ffffff">${escapeXml(brand)}</text>
    <text x="208" y="226" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="700" letter-spacing="4.2" fill="${YELLOW}" fill-opacity="0.9">FILM · DRAMA · MUSIK</text>

    <rect x="${pillX}" y="146" width="${pillWidth}" height="54" rx="27" fill="${PINK}" fill-opacity="0.16" stroke="${PINK}" stroke-opacity="0.7" stroke-width="2"/>
    <text x="${pillX + pillWidth / 2}" y="182" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="23" font-weight="800" letter-spacing="1.6" fill="#ffd9e6">${escapeXml(voiceLabel)}</text>

    ${body}

    <text x="${REEL_WIDTH - 72}" y="1512" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="700" fill="#ffffff" fill-opacity="0.35">${String(index + 1).padStart(2, "0")}</text>

    <path d="M72 1604H1008" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>
    <rect x="72" y="1636" width="132" height="8" rx="4" fill="url(#brandbar)"/>
    <text x="72" y="1700" font-family="DejaVu Sans, sans-serif" font-size="29" font-weight="700" fill="#ffffff" fill-opacity="0.82">${escapeXml(screenText(options.sourceName).slice(0, 42))}</text>
    <text x="72" y="1754" font-family="DejaVu Sans, sans-serif" font-size="29" font-weight="900" fill="${YELLOW}">${escapeXml(options.handle)}</text>
    ${facebookHandle
      ? `<text x="72" y="1794" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="600" fill="#ffffff" fill-opacity="0.42">${escapeXml(facebookHandle)}</text>`
      : ""}

    <text x="1008" y="1726" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="500" letter-spacing="1.9" fill="#ffffff" fill-opacity="0.55">${escapeXml(POWERED_BY.prefix)}</text>
    <text x="1008" y="1762" text-anchor="end" font-family="DejaVu Sans, sans-serif" font-size="29" font-weight="900" letter-spacing="1.4"><tspan fill="#ffffff">${escapeXml(POWERED_BY.markWhite)}</tspan><tspan fill="${YELLOW}">${escapeXml(POWERED_BY.markAccent)}</tspan></text>
  </svg>`;

  const logo = await reelLogo(options.brand).catch(() => undefined);
  const base = sharp(Buffer.from(svg));
  const composed = logo
    ? await base.composite([{ input: logo, left: 72, top: 126 }]).png({ compressionLevel: 9 }).toBuffer()
    : await base.png({ compressionLevel: 9 }).toBuffer();
  return composed;
}
