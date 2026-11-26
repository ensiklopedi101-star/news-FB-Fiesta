import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { circularLogoBuffer } from "@/lib/logo-circle";
import { ensureBundledFonts } from "./og-card";

/**
 * Square 2×3 quiz grid: five poster cells plus a branded cell in the bottom-right
 * corner that carries the PopBeez logo and the "Tebak Drama" wording.
 */
export const QUIZ_CARD_SIZE = 1080;
export const QUIZ_COLUMNS = 2;
export const QUIZ_ROWS = 3;
export const QUIZ_CELL_WIDTH = QUIZ_CARD_SIZE / QUIZ_COLUMNS;
export const QUIZ_CELL_HEIGHT = QUIZ_CARD_SIZE / QUIZ_ROWS;
export const QUIZ_CELL_COUNT = QUIZ_COLUMNS * QUIZ_ROWS;
/** Five posters; the sixth cell is the brand cell at the bottom-right. */
export const QUIZ_POSTER_CELLS = QUIZ_CELL_COUNT - 1;
export const QUIZ_BRAND_CELL_INDEX = QUIZ_POSTER_CELLS;

export type QuizCardOptions = {
  /** Exactly `QUIZ_POSTER_CELLS` JPEG/PNG payloads, row by row. */
  tiles: Array<Uint8Array | Buffer>;
  label?: string;
  sublabel?: string;
  brand?: string;
  brandTag?: string;
  handle?: string;
  /** Optional logo payload for the brand cell; the bundled PopBeez icon is used otherwise. */
  logo?: Uint8Array | Buffer | null;
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

const logoPromise = (() => {
  let pending: Promise<Buffer | null> | null = null;
  return () => {
    pending ??= readFile(resolve(process.cwd(), "public/brand", "popbeez_icon.png")).catch(() => null);
    return pending;
  };
})();

/** Number badges live in the poster cells only, so the brand cell stays clean. */
function buildBadges(): Buffer {
  const badges = Array.from({ length: QUIZ_POSTER_CELLS }, (_, index) => {
    const x = (index % QUIZ_COLUMNS) * QUIZ_CELL_WIDTH + QUIZ_CELL_WIDTH - 26;
    const y = Math.floor(index / QUIZ_COLUMNS) * QUIZ_CELL_HEIGHT + QUIZ_CELL_HEIGHT - 26;
    return `<g><circle cx="${x}" cy="${y}" r="21" fill="#05050a" fill-opacity=".74" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/><text x="${x}" y="${y + 8}" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="800">${index + 1}</text></g>`;
  }).join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${QUIZ_CARD_SIZE}" height="${QUIZ_CARD_SIZE}" viewBox="0 0 ${QUIZ_CARD_SIZE} ${QUIZ_CARD_SIZE}">
    <line x1="${QUIZ_CELL_WIDTH}" y1="0" x2="${QUIZ_CELL_WIDTH}" y2="${QUIZ_CELL_HEIGHT * (QUIZ_ROWS - 1)}" stroke="#0b0b10" stroke-width="3" stroke-opacity=".9"/>
    <line x1="0" y1="${QUIZ_CELL_HEIGHT}" x2="${QUIZ_CARD_SIZE}" y2="${QUIZ_CELL_HEIGHT}" stroke="#0b0b10" stroke-width="3" stroke-opacity=".9"/>
    <line x1="0" y1="${QUIZ_CELL_HEIGHT * 2}" x2="${QUIZ_CARD_SIZE}" y2="${QUIZ_CELL_HEIGHT * 2}" stroke="#0b0b10" stroke-width="3" stroke-opacity=".9"/>
    ${badges}
  </svg>`);
}

/** The bottom-right cell: PopBeez logo, wordmark, and the "Tebak Drama" label. */
function buildBrandPanel(options: QuizCardOptions): Buffer {
  const label = escapeXml(options.label ?? "TEBAK DRAMA");
  const sublabel = escapeXml(options.sublabel ?? "5 poster · jawab di komentar");
  const brand = escapeXml(options.brand ?? "PopBeez");
  const brandTag = escapeXml(options.brandTag ?? "POP CULTURE");
  const handle = escapeXml(options.handle ?? "@PORTALBEEZ");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${QUIZ_CELL_WIDTH}" height="${QUIZ_CELL_HEIGHT}" viewBox="0 0 ${QUIZ_CELL_WIDTH} ${QUIZ_CELL_HEIGHT}">
    <defs>
      <linearGradient id="quiz-brand" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1d1522"/>
        <stop offset="100%" stop-color="#0a0a0f"/>
      </linearGradient>
    </defs>
    <rect width="${QUIZ_CELL_WIDTH}" height="${QUIZ_CELL_HEIGHT}" fill="url(#quiz-brand)"/>
    <rect x="1" y="1" width="${QUIZ_CELL_WIDTH - 2}" height="${QUIZ_CELL_HEIGHT - 2}" fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="2"/>
    <rect x="0" y="0" width="7" height="${QUIZ_CELL_HEIGHT}" fill="#f20b55"/>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="172" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="900" letter-spacing=".5">${brand}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="198" text-anchor="middle" fill="#fff" fill-opacity=".7" font-family="DejaVu Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="4">${brandTag}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="240" text-anchor="middle" fill="#ffd12e" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="900" letter-spacing="2">${label}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="264" text-anchor="middle" fill="#fff" fill-opacity=".84" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="600">${sublabel}</text>
    <circle cx="146" cy="290" r="11" fill="#1877F2"/>
    <text x="146" y="295" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="900">f</text>
    <text x="164" y="295" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="800" letter-spacing=".5">${handle.toLowerCase()}</text>
    <circle cx="330" cy="290" r="10" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="330" cy="290" r="4.4" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="333" cy="287" r="1.5" fill="#fff"/>
    <text x="346" y="295" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="800" letter-spacing=".5">@popbeez.hive</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="324" text-anchor="middle" fill="#fff" fill-opacity=".5" font-family="DejaVu Sans, sans-serif" font-size="10" font-weight="600" letter-spacing="2">powered by</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="344" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="900" letter-spacing="1"><tspan fill="#ffffff">HIVE</tspan><tspan fill="#ffd12e">COMP</tspan></text>
  </svg>`);
}

/**
 * Keep the recognizable artwork as the clue. A centered crop removes much of the
 * poster title/footer bands, while preserving the cast, palette, and composition
 * that viewers can recognize; unlike the former silhouette treatment, it does
 * not turn every drama into an abstract shape.
 */
async function renderPosterCell(tile: Uint8Array | Buffer): Promise<Buffer> {
  const rotated = await sharp(Buffer.from(tile), { limitInputPixels: 40_000_000 }).rotate().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const sourceWidth = metadata.width ?? 600;
  const sourceHeight = metadata.height ?? 900;
  const cropTop = Math.round(sourceHeight * 0.14);
  const cropHeight = Math.max(1, Math.min(Math.round(sourceHeight * 0.72), sourceHeight - cropTop));
  const crop = await sharp(rotated)
    .extract({ left: 0, top: cropTop, width: sourceWidth, height: cropHeight })
    .resize(QUIZ_CELL_WIDTH, QUIZ_CELL_HEIGHT, { fit: "cover", position: "attention" })
    .jpeg({ quality: 90 })
    .toBuffer();
  // A light vignette improves contrast with the number badge without hiding the clue.
  const shade = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${QUIZ_CELL_WIDTH}" height="${QUIZ_CELL_HEIGHT}"><rect width="100%" height="100%" fill="#07070b" fill-opacity=".08"/><rect y="${QUIZ_CELL_HEIGHT - 54}" width="100%" height="54" fill="#07070b" fill-opacity=".12"/></svg>`);
  return sharp(crop).composite([{ input: shade }]).jpeg({ quality: 90 }).toBuffer();
}

export async function renderQuizCard(options: QuizCardOptions): Promise<Buffer> {
  const tiles = options.tiles.filter((tile): tile is Uint8Array | Buffer => Boolean(tile?.byteLength));
  if (tiles.length !== QUIZ_POSTER_CELLS) {
    throw new Error(`Grid kuis membutuhkan tepat ${QUIZ_POSTER_CELLS} gambar, tersedia ${tiles.length}.`);
  }
  await ensureBundledFonts();

  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const [index, tile] of tiles.entries()) {
    layers.push({
      input: await renderPosterCell(tile),
      left: (index % QUIZ_COLUMNS) * QUIZ_CELL_WIDTH,
      top: Math.floor(index / QUIZ_COLUMNS) * QUIZ_CELL_HEIGHT,
    });
  }

  const brandLeft = (QUIZ_BRAND_CELL_INDEX % QUIZ_COLUMNS) * QUIZ_CELL_WIDTH;
  const brandTop = Math.floor(QUIZ_BRAND_CELL_INDEX / QUIZ_COLUMNS) * QUIZ_CELL_HEIGHT;
  layers.push({ input: buildBrandPanel(options), left: brandLeft, top: brandTop });

  const logo = options.logo ? Buffer.from(options.logo) : await logoPromise();
  if (logo?.byteLength) {
    try {
      // Circular mask that trims the white square border of the uploaded logo.
      const renderedLogo = await circularLogoBuffer(logo, 116);
      layers.push({ input: renderedLogo, left: brandLeft + Math.round((QUIZ_CELL_WIDTH - 116) / 2), top: brandTop + 20 });
    } catch {
      console.warn("[quiz] logo PopBeez gagal disiapkan; sel merek tampil tanpa logo.");
    }
  }

  layers.push({ input: buildBadges(), left: 0, top: 0 });

  const base = await sharp({
    create: { width: QUIZ_CARD_SIZE, height: QUIZ_CARD_SIZE, channels: 4, background: "#0b0b10" },
  }).png().toBuffer();

  return sharp(base).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
