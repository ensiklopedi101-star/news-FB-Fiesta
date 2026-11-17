import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1350;
const HEADER_HEIGHT = 132;
const PHOTO_HEIGHT = 660;
const PHOTO_TOP = HEADER_HEIGHT;
const FOOTER_TOP = PHOTO_TOP + PHOTO_HEIGHT;
let fontconfigPromise: Promise<void> | undefined;

async function ensureBundledFonts(): Promise<void> {
  if (!fontconfigPromise) {
    fontconfigPromise = (async () => {
      const fontsDirectory = resolve(process.cwd(), "assets/fonts");
      const cacheDirectory = "/tmp/news-fb-fiesta-fontconfig-cache";
      const configPath = "/tmp/news-fb-fiesta-fonts.conf";
      const config = `<fontconfig><dir>${fontsDirectory}</dir><cachedir>${cacheDirectory}</cachedir></fontconfig>`;
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(configPath, config, "utf8");
      process.env.FONTCONFIG_FILE = configPath;
      process.env.FONTCONFIG_PATH = "/tmp";
    })();
  }
  await fontconfigPromise;
}

export type OgCardOptions = {
  brand: string;
  category: string;
  title: string;
  sourceName: string;
  isEntertainment: boolean;
  photoJpeg?: Uint8Array | null;
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

function wrapWords(value: string, maxCharacters: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && candidate.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function buildSvg(options: OgCardOptions): string {
  const palette = options.isEntertainment
    ? { dark: "#641735", accent: "#e42d80", light: "#fff3f8", soft: "#ffc84a" }
    : { dark: "#173b61", accent: "#e44d47", light: "#f3f7fc", soft: "#f7c84b" };
  const title = options.title.trim().slice(0, 130);
  const titleFontSize = title.length > 100 ? 48 : title.length > 70 ? 52 : 58;
  const titleLines = wrapWords(title, Math.floor(972 / (titleFontSize * 0.78))).slice(0, 6);
  const titleLineHeight = titleFontSize * 1.13;
  const titleMarkup = titleLines.map((line, index) =>
    `<tspan x="54" dy="${index === 0 ? 0 : titleLineHeight}">${escapeXml(line)}</tspan>`,
  ).join("");
  const brand = escapeXml(options.brand);
  const category = escapeXml(options.category);
  const sourceName = escapeXml(options.sourceName.slice(0, 80));
  const categoryWidth = Math.min(440, Math.max(170, options.category.length * 19 + 56));
  const categoryLeft = WIDTH - categoryWidth - 48;
  const photoBackground = options.photoJpeg
    ? ""
    : `<rect x="0" y="${PHOTO_TOP}" width="${WIDTH}" height="${PHOTO_HEIGHT}" fill="url(#fallback)" />
       <circle cx="880" cy="270" r="175" fill="${palette.soft}" opacity=".18" />
       <circle cx="220" cy="720" r="265" fill="none" stroke="${palette.soft}" stroke-width="20" opacity=".2" />
       <text x="540" y="390" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="700" letter-spacing="8">${options.isEntertainment ? "POP CULTURE" : "KABAR NUSANTARA"}</text>
       <text x="540" y="492" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="78" font-weight="900" letter-spacing="3">${escapeXml(options.brand.toUpperCase())}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="fallback" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${palette.dark}"/><stop offset="100%" stop-color="${palette.accent}"/></linearGradient>
      <linearGradient id="photoShade" x1="0" y1="0" x2="0" y2="1"><stop offset="48%" stop-color="#111827" stop-opacity="0"/><stop offset="100%" stop-color="#111827" stop-opacity=".8"/></linearGradient>
    </defs>
    <rect x="0" y="${FOOTER_TOP}" width="${WIDTH}" height="${HEIGHT - FOOTER_TOP}" fill="${palette.light}" />
    ${photoBackground}
    ${options.photoJpeg ? `<rect x="0" y="${PHOTO_TOP}" width="${WIDTH}" height="${PHOTO_HEIGHT}" fill="url(#photoShade)" />` : ""}
    <rect x="0" y="0" width="${WIDTH}" height="${HEADER_HEIGHT}" fill="${palette.dark}" />
    <circle cx="88" cy="66" r="42" fill="${palette.accent}" />
    <text x="88" y="81" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="45" font-weight="900">${escapeXml(options.brand.slice(0, 1).toUpperCase())}</text>
    <text x="150" y="82" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="42" font-weight="800">${brand}</text>
    <rect x="${categoryLeft}" y="38" width="${categoryWidth}" height="58" rx="29" fill="${palette.accent}" />
    <text x="${categoryLeft + categoryWidth / 2}" y="76" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="23" font-weight="800" letter-spacing="2">${category}</text>
    <rect x="48" y="${PHOTO_TOP + PHOTO_HEIGHT - 72}" width="${Math.min(600, Math.max(220, options.sourceName.length * 16 + 44))}" height="48" rx="10" fill="#101b2d" fill-opacity=".82" />
    <text x="70" y="${PHOTO_TOP + PHOTO_HEIGHT - 40}" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="600">${sourceName}</text>
    <text x="54" y="${FOOTER_TOP + 86}" fill="${palette.dark}" font-family="DejaVu Sans, sans-serif" font-size="${titleFontSize}" font-weight="800" letter-spacing="-1">${titleMarkup}</text>
    <line x1="54" y1="1267" x2="1026" y2="1267" stroke="${palette.accent}" stroke-width="4" />
    <text x="54" y="1310" fill="#53657a" font-family="DejaVu Sans, sans-serif" font-size="23" font-weight="700">RINGKASAN BERITA</text>
    <text x="1026" y="1310" text-anchor="end" fill="#53657a" font-family="DejaVu Sans, sans-serif" font-size="23">${brand}</text>
  </svg>`;
}

/** Compose the article photo and an SVG card overlay directly with Sharp (no Satori/ImageResponse). */
export async function renderOgCard(options: OgCardOptions): Promise<Buffer> {
  await ensureBundledFonts();
  const base = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#f3f7fc" },
  }).png().toBuffer();
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];

  if (options.photoJpeg?.byteLength) {
    const photo = await sharp(Buffer.from(options.photoJpeg), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(WIDTH, PHOTO_HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 88 })
      .toBuffer();
    layers.push({ input: photo, left: 0, top: PHOTO_TOP });
  }

  layers.push({ input: Buffer.from(buildSvg(options)), left: 0, top: 0 });
  return sharp(base).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
