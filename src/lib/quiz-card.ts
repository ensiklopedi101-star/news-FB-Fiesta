import { Buffer } from "node:buffer";
import sharp from "sharp";
import { ensureBundledFonts } from "./og-card";

/** Square 4×3 tile grid for the "Tebak Dramanya" quiz, with a label plate in the middle. */
export const QUIZ_CARD_SIZE = 1080;
export const QUIZ_COLUMNS = 4;
export const QUIZ_ROWS = 3;
export const QUIZ_TILE_WIDTH = QUIZ_CARD_SIZE / QUIZ_COLUMNS;
export const QUIZ_TILE_HEIGHT = QUIZ_CARD_SIZE / QUIZ_ROWS;
export const QUIZ_TILE_COUNT = QUIZ_COLUMNS * QUIZ_ROWS;

export type QuizCardOptions = {
  /** Exactly `QUIZ_TILE_COUNT` JPEG/PNG payloads, row by row. */
  tiles: Array<Uint8Array | Buffer>;
  label?: string;
  sublabel?: string;
  brand?: string;
  brandTag?: string;
  handle?: string;
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

function buildOverlay(options: QuizCardOptions): Buffer {
  const label = escapeXml(options.label ?? "TEBAK DRAMANYA");
  const sublabel = escapeXml(options.sublabel ?? "12 drama · jawab di komentar");
  const brand = escapeXml(options.brand ?? "Popbeez");
  const brandTag = escapeXml(options.brandTag ?? "POP CULTURE");
  const handle = escapeXml(options.handle ?? "@PORTALBEEZ");
  const verticals = Array.from({ length: QUIZ_COLUMNS - 1 }, (_, index) => `<line x1="${(index + 1) * QUIZ_TILE_WIDTH}" y1="0" x2="${(index + 1) * QUIZ_TILE_WIDTH}" y2="${QUIZ_CARD_SIZE}" stroke="#0b0b10" stroke-width="4" stroke-opacity=".85"/>`).join("");
  const horizontals = Array.from({ length: QUIZ_ROWS - 1 }, (_, index) => `<line x1="0" y1="${(index + 1) * QUIZ_TILE_HEIGHT}" x2="${QUIZ_CARD_SIZE}" y2="${(index + 1) * QUIZ_TILE_HEIGHT}" stroke="#0b0b10" stroke-width="4" stroke-opacity=".85"/>`).join("");
  const badges = Array.from({ length: QUIZ_TILE_COUNT }, (_, index) => {
    const x = (index % QUIZ_COLUMNS) * QUIZ_TILE_WIDTH + QUIZ_TILE_WIDTH - 22;
    const y = Math.floor(index / QUIZ_COLUMNS) * QUIZ_TILE_HEIGHT + QUIZ_TILE_HEIGHT - 22;
    return `<g><circle cx="${x}" cy="${y}" r="20" fill="#05050a" fill-opacity=".72" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/><text x="${x}" y="${y + 7}" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="800">${index + 1}</text></g>`;
  }).join("");

  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${QUIZ_CARD_SIZE}" height="${QUIZ_CARD_SIZE}" viewBox="0 0 ${QUIZ_CARD_SIZE} ${QUIZ_CARD_SIZE}">
    <defs>
      <linearGradient id="quiz-top" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#05050a" stop-opacity=".82"/><stop offset="100%" stop-color="#05050a" stop-opacity="0"/></linearGradient>
      <linearGradient id="quiz-bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#05050a" stop-opacity="0"/><stop offset="65%" stop-color="#05050a" stop-opacity=".78"/><stop offset="100%" stop-color="#05050a" stop-opacity=".94"/></linearGradient>
    </defs>
    ${verticals}
    ${horizontals}
    <rect width="${QUIZ_CARD_SIZE}" height="190" fill="url(#quiz-top)"/>
    <rect y="${QUIZ_CARD_SIZE - 230}" width="${QUIZ_CARD_SIZE}" height="230" fill="url(#quiz-bottom)"/>
    <text x="40" y="66" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="32" font-weight="800" letter-spacing="1">${brand}</text>
    <text x="42" y="98" fill="#fff" fill-opacity=".8" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="700" letter-spacing="3">${brandTag}</text>
    <rect x="245" y="455" width="590" height="170" rx="18" fill="#16151c" fill-opacity=".94" stroke="#fff" stroke-opacity=".3" stroke-width="2"/>
    <text x="540" y="523" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="46" font-weight="900" letter-spacing="3">${label}</text>
    <text x="540" y="575" text-anchor="middle" fill="#ffd12e" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="700">${sublabel}</text>
    <circle cx="886" cy="1017" r="16" fill="#1877F2"/>
    <text x="886" y="1025" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="25" font-weight="900">f</text>
    ${badges}
    <text x="1044" y="1023" text-anchor="end" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="800" letter-spacing=".5">${handle}</text>
  </svg>`);
}

export async function renderQuizCard(options: QuizCardOptions): Promise<Buffer> {
  const tiles = options.tiles.filter((tile): tile is Uint8Array | Buffer => Boolean(tile?.byteLength));
  if (tiles.length !== QUIZ_TILE_COUNT) {
    throw new Error(`Grid kuis membutuhkan tepat ${QUIZ_TILE_COUNT} gambar, tersedia ${tiles.length}.`);
  }
  await ensureBundledFonts();

  const base = await sharp({
    create: { width: QUIZ_CARD_SIZE, height: QUIZ_CARD_SIZE, channels: 4, background: "#0b0b10" },
  }).png().toBuffer();

  const layers: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const [index, tile] of tiles.entries()) {
    const rendered = await sharp(Buffer.from(tile), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(QUIZ_TILE_WIDTH, QUIZ_TILE_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 86 })
      .toBuffer();
    layers.push({
      input: rendered,
      left: (index % QUIZ_COLUMNS) * QUIZ_TILE_WIDTH,
      top: Math.floor(index / QUIZ_COLUMNS) * QUIZ_TILE_HEIGHT,
    });
  }
  layers.push({ input: buildOverlay(options), left: 0, top: 0 });

  return sharp(base).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}
