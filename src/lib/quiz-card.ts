import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { ensureBundledFonts } from "./og-card";
import { renderSilhouette, silhouettePalette } from "./quiz-silhouette";

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
  /** Tiles that are already flat silhouette art (AI-drawn), so they must not be re-processed. */
  prepared?: boolean[];
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
    <text x="${QUIZ_CELL_WIDTH / 2}" y="192" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="900" letter-spacing=".5">${brand}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="218" text-anchor="middle" fill="#fff" fill-opacity=".7" font-family="DejaVu Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="4">${brandTag}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="270" text-anchor="middle" fill="#ffd12e" font-family="DejaVu Sans, sans-serif" font-size="40" font-weight="900" letter-spacing="2">${label}</text>
    <text x="${QUIZ_CELL_WIDTH / 2}" y="298" text-anchor="middle" fill="#fff" fill-opacity=".84" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="600">${sublabel}</text>
    <circle cx="216" cy="324" r="13" fill="#1877F2"/>
    <text x="216" y="330" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="20" font-weight="900">f</text>
    <text x="236" y="329" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="14" font-weight="800" letter-spacing=".5">${handle}</text>
  </svg>`);
}

/**
 * Posters are photographic and carry their own title, so each cell is redrawn as a
 * flat silhouette: no face, no lettering, just the shape of the drama on paper.
 */
async function renderPosterCell(tile: Uint8Array | Buffer, index: number, prepared: boolean): Promise<Buffer> {
  const palette = silhouettePalette(index);
  const margin = 14;
  const art = prepared
    ? await preparedArt(tile, QUIZ_CELL_WIDTH, QUIZ_CELL_HEIGHT)
    : await renderSilhouette(tile, {
        palette,
        width: Math.round(QUIZ_CELL_WIDTH * 0.62),
        height: QUIZ_CELL_HEIGHT - margin * 2,
      });
  if (prepared) return sharp(art).jpeg({ quality: 92 }).toBuffer();

  const sheet = await sharp({
    create: { width: QUIZ_CELL_WIDTH, height: QUIZ_CELL_HEIGHT, channels: 3, background: palette.paper },
  }).png().toBuffer();
  return sharp(sheet)
    .composite([{
      input: art,
      left: Math.round((QUIZ_CELL_WIDTH - Math.round(QUIZ_CELL_WIDTH * 0.62)) / 2),
      top: margin,
    }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * Flat art that already carries its own paper colour is only fitted to the cell:
 * the artwork is centred on a sheet of its own background tone.
 */
async function preparedArt(tile: Uint8Array | Buffer, width: number, height: number): Promise<Buffer> {
  // Never crop hand-drawn silhouettes: fit the whole artwork on a sheet of its own paper tone.
  const fitted = await sharp(Buffer.from(tile), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(width, height, { fit: "inside" })
    .png()
    .toBuffer();
  const metadata = await sharp(fitted).metadata();
  const artWidth = metadata.width ?? width;
  const artHeight = metadata.height ?? height;
  // The paper tone is whatever the artwork's top-left corner is; the ink shape is dominant.
  const [paperRed = 247, paperGreen = 231, paperBlue = 207] = await sharp(fitted)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  const background = { r: paperRed, g: paperGreen, b: paperBlue };
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{
      input: fitted,
      left: Math.round((width - artWidth) / 2),
      top: Math.round((height - artHeight) / 2),
    }])
    .png()
    .toBuffer();
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
      input: await renderPosterCell(tile, index, options.prepared?.[index] ?? false),
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
      const renderedLogo = await sharp(logo, { limitInputPixels: 40_000_000 })
        .resize(116, 116, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
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
