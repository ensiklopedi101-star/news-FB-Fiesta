import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { ManualReviewItem, ReviewMediaType } from "@/lib/manual-review";

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
  photoJpegSecondary?: Uint8Array | null;
  slide?: { number: number; total: number; label: string; text?: string; isFollowCta?: boolean };
  reviewSlide?: { number: number; total: number; headline: string; mediaType: ReviewMediaType; item?: ManualReviewItem };
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
    ${options.photoJpegSecondary ? `<line x1="540" y1="190" x2="540" y2="900" stroke="#fff" stroke-width="5" stroke-opacity=".7"/>` : ""}
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

function reviewTextLines(value: string, maxCharacters: number, maxLines: number): string[] {
  const lines = wrapWords(value, maxCharacters).slice(0, maxLines);
  if (wrapWords(value, maxCharacters).length > maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1]!.replace(/[.…]+$/, "")}…`;
  }
  return lines;
}

function buildReviewSvg(review: NonNullable<OgCardOptions["reviewSlide"]>): string {
  const pink = "#f20b55";
  const mediaLabel = review.mediaType === "FILM" ? "FILM" : review.mediaType === "DRAMA" ? "DRAMA" : "MUSIK";
  const cover = review.number === 1;
  const item = review.item;
  const titleLines = reviewTextLines(cover ? review.headline : (item?.title ?? "Judul belum tersedia"), cover ? 16 : 18, cover ? 5 : 3);
  const titleFont = cover ? 61 : 44;
  const titleStart = cover ? 310 : 260;
  const headline = titleLines.map((line, index) => `<text x="76" y="${titleStart + index * (titleFont + 10)}" fill="${index === 0 ? pink : "#fff"}" font-family="DejaVu Sans, sans-serif" font-size="${titleFont}" font-weight="900" letter-spacing="-1">${escapeXml(line)}</text>`).join("");
  const genre = item ? reviewTextLines(item.genre, 38, 2) : [];
  const reason = item?.reason ? reviewTextLines(item.reason, 39, 4) : [];
  const suitable = item?.suitableFor ? reviewTextLines(item.suitableFor, 38, 2) : [];
  const genreMarkup = genre.map((line, index) => `<text x="78" y="${550 + index * 30}" fill="#fff" fill-opacity=".83" font-family="DejaVu Sans, sans-serif" font-size="21" font-weight="600">${escapeXml(line)}</text>`).join("");
  const reasonMarkup = reason.map((line, index) => `<text x="78" y="${645 + index * 27}" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="500">${escapeXml(line)}</text>`).join("");
  const suitableStart = 785 + reason.length * 27;
  const suitableMarkup = suitable.map((line, index) => `<text x="78" y="${suitableStart + index * 27}" fill="#fff" fill-opacity=".85" font-family="DejaVu Sans, sans-serif" font-size="18" font-weight="500">${escapeXml(line)}</text>`).join("");
  const eyebrow = cover
    ? `<text x="78" y="244" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="900" letter-spacing="4">REKOMENDASI MINGGU INI</text>`
    : `<text x="78" y="205" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="25" font-weight="900" letter-spacing="3">NOMOR ${review.number - 1} · ${mediaLabel}</text>`;
  const ratingMarkup = !cover && item
    ? `<text x="78" y="${titleStart + titleLines.length * (titleFont + 10) + 24}" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="36" font-weight="900">★ ${item.rating.toFixed(1)} / 10</text><text x="78" y="520" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="900" letter-spacing="2">GENRE</text>${genreMarkup}<text x="78" y="618" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="900" letter-spacing="2">KENAPA WAJIB DITONTON</text>${reasonMarkup}${item.suitableFor ? `<text x="78" y="${suitableStart - 22}" fill="${pink}" font-family="DejaVu Sans, sans-serif" font-size="16" font-weight="900" letter-spacing="2">COCOK UNTUK</text>${suitableMarkup}` : ""}`
    : "";
  const coverSub = cover
    ? `<text x="78" y="${titleStart + titleLines.length * (titleFont + 10) + 38}" fill="#fff" fill-opacity=".84" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="600">Geser untuk lihat lima pilihan dengan rating tertinggi</text><rect x="78" y="${titleStart + titleLines.length * (titleFont + 10) + 76}" width="245" height="7" rx="3" fill="${pink}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <rect x="0" y="0" width="625" height="1080" fill="#08080a"/>
    <rect x="595" y="38" width="445" height="1004" fill="none" stroke="#fff" stroke-width="3" opacity=".85"/>
    <path d="M45 148H565" stroke="#f20b55" stroke-width="3"/><path d="M45 920H565" stroke="#fff" stroke-width="2" opacity=".45"/>
    <text x="78" y="95" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="33" font-weight="900" letter-spacing="2">POPBEEZ</text>
    <text x="78" y="142" fill="#fff" fill-opacity=".66" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="700" letter-spacing="4">FILM · DRAMA · MUSIK</text>
    ${eyebrow}${headline}${coverSub}${ratingMarkup}
    <path d="M912 72l65 65-65 65M1000 72l-65 65 65 65" fill="none" stroke="#fff" stroke-width="12" opacity=".8"/>
    <text x="78" y="986" fill="#fff" fill-opacity=".9" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="800" letter-spacing="2">GESER · ${review.number}/${review.total}</text>
    <text x="1000" y="986" text-anchor="end" fill="#fff" font-family="DejaVu Sans, sans-serif" font-size="17" font-weight="800">IKUTI @PORTALBEEZ</text>
    <path d="M1020 1015l-35 35m35-35h-34m34 0v34" fill="none" stroke="#fff" stroke-width="7"/>
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
  if (options.reviewSlide) {
    const base = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: "#f20b55" } }).png().toBuffer();
    const layers: Array<{ input: Buffer; left: number; top: number }> = [];
    if (options.photoJpeg?.byteLength) {
      const photo = await sharp(Buffer.from(options.photoJpeg), { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(445, 1_004, { fit: "cover", position: "centre" })
        .jpeg({ quality: 88 })
        .toBuffer();
      layers.push({ input: photo, left: 595, top: 38 });
    }
    layers.push({ input: Buffer.from(buildReviewSvg(options.reviewSlide)), left: 0, top: 0 });
    return sharp(base).composite(layers).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  const base = await sharp({
    create: { width: WIDTH, height: HEIGHT, channels: 4, background: "#101722" },
  }).png().toBuffer();
  const layers: Array<{ input: Buffer; left: number; top: number }> = [];

  if (options.photoJpeg?.byteLength && options.photoJpegSecondary?.byteLength) {
    const [firstPhoto, secondPhoto] = await Promise.all([options.photoJpeg, options.photoJpegSecondary].map(async (bytes) =>
      sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 }).rotate().resize(540, HEIGHT, { fit: "cover", position: "centre" }).jpeg({ quality: 88 }).toBuffer()));
    layers.push({ input: firstPhoto, left: 0, top: 0 }, { input: secondPhoto, left: 540, top: 0 });
  } else if (options.photoJpeg?.byteLength) {
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
