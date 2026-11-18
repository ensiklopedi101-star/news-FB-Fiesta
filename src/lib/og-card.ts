import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const WIDTH = 1080;
const HEIGHT = 1080;
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
  slide?: { number: number; total: number; label: string; text?: string; isFollowCta?: boolean };
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

function fitHeadline(rawTitle: string): { lines: string[]; fontSize: number; lineHeight: number } {
  const title = rawTitle.trim().replace(/\s+/g, " ").toLocaleUpperCase("id-ID").slice(0, 130);
  for (const fontSize of [76, 68, 60, 54, 48, 44]) {
    const lines = wrapWords(title, Math.floor(970 / (fontSize * 0.76)));
    if (lines.length <= 4) return { lines, fontSize, lineHeight: fontSize * 1.06 };
  }
  const fontSize = 40;
  const lines = wrapWords(title, Math.floor(970 / (fontSize * 0.76))).slice(0, 5);
  return { lines, fontSize, lineHeight: fontSize * 1.05 };
}

function buildSvg(options: OgCardOptions): string {
  const palette = options.isEntertainment
    ? { dark: "#641735", accent: "#e42d80", highlight: "#ffd12e" }
    : { dark: "#10243a", accent: "#f2b900", highlight: "#ffd12e" };
  const title = fitHeadline(options.title);
  const titleTop = 700 - ((title.lines.length - 1) * title.lineHeight) / 2;
  const titleMarkup = title.lines.map((line, index) =>
    `<text x="540" y="${titleTop + index * title.lineHeight}" text-anchor="middle" fill="${index === 0 ? palette.highlight : "#fff"}" font-family="DejaVu Sans, sans-serif" font-size="${title.fontSize}" font-weight="900" letter-spacing="-1">${escapeXml(line)}</text>`,
  ).join("");
  const slideText = options.slide?.text?.trim();
  const slideLines = slideText ? wrapWords(slideText, 34).slice(0, 6) : [];
  const followSlideMarkup = options.slide?.isFollowCta
    ? `<text x="540" y="474" text-anchor="middle" fill="${palette.highlight}" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="800" letter-spacing="3">IKUTI POPBEEZ</text><circle cx="540" cy="612" r="58" fill="#1877F2"/><text x="540" y="642" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="94" font-weight="900">f</text><text x="540" y="740" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="31" font-weight="700">Ikuti untuk update hiburan</text><text x="540" y="802" text-anchor="middle" fill="#fff" fill-opacity=".9" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="600">facebook.com/portalbeez</text>`
    : "";
  const slideContentMarkup = followSlideMarkup || (slideLines.length
    ? `<text x="540" y="474" text-anchor="middle" fill="${palette.highlight}" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="800" letter-spacing="3">${escapeXml(options.slide?.label ?? "INTI BERITA")}</text>${slideLines.map((line, index) => `<text x="540" y="${560 + index * 51}" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="800">${escapeXml(line)}</text>`).join("")}`
    : titleMarkup);
  const slideIndicator = options.slide
    ? `<text x="540" y="875" text-anchor="middle" fill="#fff" fill-opacity=".9" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="800" letter-spacing="3">GESER · ${options.slide.number}/${options.slide.total}</text>`
    : "";
  const brand = escapeXml(options.brand.trim().slice(0, 24));
  const category = escapeXml(options.category.trim().toUpperCase().slice(0, 24));
  const showFollowFooter = options.isEntertainment && (!options.slide || options.slide.isFollowCta === true);
  const sourceName = escapeXml(options.sourceName.trim().slice(0, showFollowFooter ? 30 : 48));
  const categoryWidth = Math.min(420, Math.max(170, category.length * 20 + 64));
  const categoryLeft = WIDTH - categoryWidth - 46;
  const fallback = options.photoJpeg
    ? ""
    : `<rect width="${WIDTH}" height="${HEIGHT}" fill="${palette.dark}"/><path d="M0 0H1080V1080H0Z" fill="url(#fallback)"/><circle cx="900" cy="210" r="260" fill="${palette.accent}" opacity=".22"/><circle cx="120" cy="900" r="330" fill="none" stroke="${palette.highlight}" stroke-width="22" opacity=".18"/>`;
  const footerIdentity = showFollowFooter
    ? `<circle cx="785" cy="978" r="17" fill="#1877F2"/><text x="785" y="987" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="900">f</text><text x="1008" y="985" text-anchor="end" fill="#fff" fill-opacity=".9" font-family="DejaVu Sans, sans-serif" font-size="15" font-weight="800" letter-spacing=".5">FOLLOW @PORTALBEEZ</text>`
    : `<text x="1008" y="989" text-anchor="end" fill="#fff" fill-opacity=".82" font-family="DejaVu Sans, sans-serif" font-size="19" font-weight="600">${options.isEntertainment ? "POPBEEZ" : "NUSABEEZ"}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="fallback" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${palette.dark}"/><stop offset="100%" stop-color="${palette.accent}"/></linearGradient>
      <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#06111d" stop-opacity=".59"/><stop offset="42%" stop-color="#06111d" stop-opacity=".24"/><stop offset="75%" stop-color="#06111d" stop-opacity=".60"/><stop offset="100%" stop-color="#06111d" stop-opacity=".93"/></linearGradient>
    </defs>
    ${fallback}
    ${options.photoJpeg ? `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#shade)"/>` : ""}
    <rect width="${WIDTH}" height="190" fill="#06111d" fill-opacity=".40"/>
    <rect y="895" width="${WIDTH}" height="185" fill="#06111d" fill-opacity=".26"/>
    <text x="178" y="93" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="37" font-weight="800">${brand}</text>
    <text x="180" y="132" fill="#fff" fill-opacity=".78" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="600" letter-spacing="3">${options.isEntertainment ? "POP CULTURE" : "BERITA TERKINI"}</text>
    <rect x="${categoryLeft}" y="48" width="${categoryWidth}" height="56" rx="28" fill="#fff" fill-opacity=".15" stroke="#fff" stroke-opacity=".65" stroke-width="2"/>
    <text x="${categoryLeft + categoryWidth / 2}" y="84" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="800" letter-spacing="2">${category}</text>
    <text x="540" y="337" text-anchor="middle" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="27" font-weight="700" letter-spacing="4">${options.isEntertainment ? "SOROTAN HIBURAN" : "KABAR HARI INI"}</text>
    ${slideContentMarkup}
    ${slideIndicator}
    <line x1="72" y1="936" x2="1008" y2="936" stroke="${palette.highlight}" stroke-width="3" stroke-opacity=".9"/>
    <text x="72" y="989" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="700" letter-spacing="1">${sourceName}</text>
    ${footerIdentity}
  </svg>`;
}

const logoBuffers = new Map<string, Promise<Buffer>>();
async function loadBrandLogo(isEntertainment: boolean): Promise<Buffer> {
  const file = isEntertainment ? "popbeez_icon.png" : "nusabeez_icon.png";
  let pending = logoBuffers.get(file);
  if (!pending) {
    pending = readFile(resolve(process.cwd(), "public/brand", file));
    logoBuffers.set(file, pending);
  }
  return pending;
}

/** Compose a full-bleed, square news card with Sharp and SVG; use the actual bundled page logo asset. */
export async function renderOgCard(options: OgCardOptions): Promise<Buffer> {
  await ensureBundledFonts();
  const base = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#101722" },
  }).png().toBuffer();
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];

  if (options.photoJpeg?.byteLength) {
    const photo = await sharp(Buffer.from(options.photoJpeg), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" })
      .jpeg({ quality: 88 })
      .toBuffer();
    layers.push({ input: photo, left: 0, top: 0 });
  }

  const logo = await sharp(await loadBrandLogo(options.isEntertainment))
    .resize(112, 112, { fit: "contain" })
    .png()
    .toBuffer();
  layers.push({ input: Buffer.from(buildSvg(options)), left: 0, top: 0 });
  layers.push({ input: logo, left: 44, top: 34 });
  return sharp(base).composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
}
