import { Buffer } from "node:buffer";
import sharp from "sharp";

/**
 * Turns a drama/film poster into flat 2D quiz art: a single-colour silhouette on
 * paper, so no face (eyes, nose, mouth) and no printed title survives, while the
 * pose and outfit still hint at which drama it is.
 */
export type SilhouettePalette = { paper: string; ink: string };

/** Portrait figure, centred on the paper of one quiz cell. */
export const SILHOUETTE_WIDTH = 300;
export const SILHOUETTE_HEIGHT = 380;

/** Pastel paper keeps the grid friendly; the ink is shared so the silhouettes read as one set. */
export const SILHOUETTE_PALETTES: SilhouettePalette[] = [
  { paper: "#f7e7cf", ink: "#17121c" },
  { paper: "#e2edf7", ink: "#101822" },
  { paper: "#eee4f8", ink: "#181226" },
  { paper: "#e7f0e2", ink: "#101b12" },
  { paper: "#fbe9bd", ink: "#1d1608" },
];

export function silhouettePalette(index: number): SilhouettePalette {
  const length = SILHOUETTE_PALETTES.length;
  return SILHOUETTE_PALETTES[((index % length) + length) % length]!;
}

const MASK_WIDTH = 120;
const MASK_HEIGHT = 152;
/** Keeps the ink share sane: below this the tile gets a placeholder, above it the mask flips. */
const MIN_INK_SHARE = 0.05;
const MAX_INK_SHARE = 0.72;
const ART_BAND_TOP = 0.22;
const ART_BAND_HEIGHT = 0.56;

function toRgb(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}


/** Bimodal split of the luminance histogram: the classic stencil threshold. */
function otsuThreshold(levels: Uint8Array): number {
  const histogram = new Array<number>(256).fill(0);
  for (const level of levels) histogram[level]! += 1;
  const total = levels.length;
  let sum = 0;
  for (let value = 0; value < 256; value += 1) sum += value * histogram[value]!;
  let sumB = 0;
  let weightB = 0;
  let best = 128;
  let bestVariance = -1;
  for (let value = 0; value < 256; value += 1) {
    weightB += histogram[value]!;
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += value * histogram[value]!;
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = value;
    }
  }
  return best;
}

/** Keeps the subject blob and drops specks, so stray letters never become "dirt". */
function largestComponents(mask: Uint8Array, width: number, height: number): Uint8Array {
  const labels = new Int32Array(mask.length).fill(-1);
  const areas: number[] = [];
  const stack: number[] = [];
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || labels[index] !== -1) continue;
    const label = areas.length;
    let area = 0;
    stack.push(index);
    labels[index] = label;
    while (stack.length) {
      const current = stack.pop()!;
      area += 1;
      const x = current % width;
      const y = (current - x) / width;
      const neighbours = [
        x > 0 ? current - 1 : -1,
        x < width - 1 ? current + 1 : -1,
        y > 0 ? current - width : -1,
        y < height - 1 ? current + width : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || !mask[neighbour] || labels[neighbour] !== -1) continue;
        labels[neighbour] = label;
        stack.push(neighbour);
      }
    }
    areas.push(area);
  }
  const largest = Math.max(0, ...areas);
  const keep = new Set<number>();
  areas.forEach((area, label) => {
    if (area >= Math.max(40, largest * 0.12)) keep.add(label);
  });
  const output = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) {
    const label = labels[index]!;
    output[index] = label >= 0 && keep.has(label) ? 1 : 0;
  }
  return output;
}

/** Silhouettes are solid shapes: holes punched by sky, snow or a bright scarf get filled. */
function fillHoles(mask: Uint8Array, width: number, height: number): Uint8Array {
  const outside = new Uint8Array(mask.length);
  const stack: number[] = [];
  const push = (index: number) => {
    if (mask[index] || outside[index]) return;
    outside[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const current = stack.pop()!;
    const x = current % width;
    const y = (current - x) / width;
    if (x > 0) push(current - 1);
    if (x < width - 1) push(current + 1);
    if (y > 0) push(current - width);
    if (y < height - 1) push(current + width);
  }
  const output = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) output[index] = outside[index] ? 0 : 1;
  return output;
}

function smooth(mask: Uint8Array, width: number, height: number, rounds: number): Uint8Array {
  let current = mask;
  for (let round = 0; round < rounds; round += 1) {
    const output = new Uint8Array(current.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let ink = 0;
        let total = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          total += 1;
          ink += current[ny * width + nx]!;
        }
        output[y * width + x] = ink * 2 > total ? 1 : 0;
      }
    }
    current = output;
  }
  return current;
}

/** Night posters light the subject; studio posters darken it. Look at the middle of the art. */
function isSubjectBright(levels: Uint8Array, width: number, height: number): boolean {
  const cx0 = Math.round(width * 0.28);
  const cx1 = Math.round(width * 0.72);
  const cy0 = Math.round(height * 0.25);
  const cy1 = Math.round(height * 0.85);
  let centerSum = 0;
  let centerCount = 0;
  let ringSum = 0;
  let ringCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = levels[y * width + x]!;
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        centerSum += value;
        centerCount += 1;
      } else {
        ringSum += value;
        ringCount += 1;
      }
    }
  }
  return centerSum / centerCount > ringSum / ringCount;
}

export type SilhouetteOptions = {
  palette?: SilhouettePalette;
  width?: number;
  height?: number;
};

/** Paper sheet with a single ink shape: used when a poster has no separable artwork. */
function placeholderSheet(palette: SilhouettePalette, width: number, height: number): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" fill="${palette.paper}"/>
    <text x="${width / 2}" y="${Math.round(height * 0.62)}" text-anchor="middle" fill="${palette.ink}" font-family="DejaVu Sans, sans-serif" font-size="${Math.round(width * 0.5)}" font-weight="900">?</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Renders one poster as flat silhouettes. Posters print their titles in the top and
 * bottom bands, so only the middle band of the artwork is used, and the outer ring of
 * the mask is cleared — printed text can never leak into the quiz tile.
 */
export async function renderSilhouette(source: Uint8Array | Buffer, options: SilhouetteOptions = {}): Promise<Buffer> {
  const palette = options.palette ?? SILHOUETTE_PALETTES[0]!;
  const outWidth = options.width ?? SILHOUETTE_WIDTH;
  const outHeight = options.height ?? SILHOUETTE_HEIGHT;

  const rotated = await sharp(Buffer.from(source), { limitInputPixels: 40_000_000 }).rotate().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const sourceWidth = metadata.width ?? 600;
  const sourceHeight = metadata.height ?? 900;

  const bandTop = Math.round(sourceHeight * ART_BAND_TOP);
  const bandHeight = Math.max(1, Math.min(Math.round(sourceHeight * ART_BAND_HEIGHT), sourceHeight - bandTop));

  // Keep a portrait slice of that band, so a standing figure fits the silhouette frame.
  const sliceWidth = Math.max(1, Math.min(sourceWidth, Math.round(bandHeight * 0.78)));
  const sliceLeft = Math.round((sourceWidth - sliceWidth) / 2);

  const raw = await sharp(rotated)
    .extract({ left: sliceLeft, top: bandTop, width: sliceWidth, height: bandHeight })
    .resize(MASK_WIDTH, MASK_HEIGHT, { fit: "cover", position: "attention" })
    .greyscale()
    .blur(1.3)
    .normalize()
    .raw()
    .toBuffer();

  const levels = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) levels[index] = raw[index]!;

  const brightSubject = isSubjectBright(levels, MASK_WIDTH, MASK_HEIGHT);
  const threshold = otsuThreshold(levels);
  let mask: Uint8Array = new Uint8Array(levels.length);
  for (let index = 0; index < levels.length; index += 1) {
    mask[index] = brightSubject
      ? levels[index]! >= threshold ? 1 : 0
      : levels[index]! <= threshold ? 1 : 0;
  }

  mask = largestComponents(mask, MASK_WIDTH, MASK_HEIGHT);
  mask = fillHoles(mask, MASK_WIDTH, MASK_HEIGHT);
  mask = smooth(mask, MASK_WIDTH, MASK_HEIGHT, 2);

  // A poster that is mostly dark would otherwise turn into one black rectangle.
  let covered = 0;
  for (const value of mask) covered += value;
  if (covered / mask.length > MAX_INK_SHARE) {
    for (let index = 0; index < mask.length; index += 1) mask[index] = 1 - mask[index]!;
    covered = mask.length - covered;
    mask = largestComponents(mask, MASK_WIDTH, MASK_HEIGHT);
    mask = fillHoles(mask, MASK_WIDTH, MASK_HEIGHT);
    mask = smooth(mask, MASK_WIDTH, MASK_HEIGHT, 2);
  }

  // Edge ring stays paper: any title fragment that slipped into the band disappears.
  for (let y = 0; y < MASK_HEIGHT; y += 1) {
    for (let x = 0; x < MASK_WIDTH; x += 1) {
      if (y < 2 || y >= MASK_HEIGHT - 2 || x < 1 || x >= MASK_WIDTH - 1) mask[y * MASK_WIDTH + x] = 0;
    }
  }

  let inkPixels = 0;
  for (const value of mask) inkPixels += value;
  if (inkPixels < mask.length * MIN_INK_SHARE) {
    return placeholderSheet(palette, outWidth, outHeight);
  }

  const [paperR, paperG, paperB] = toRgb(palette.paper);
  const [inkR, inkG, inkB] = toRgb(palette.ink);
  const rgb = Buffer.alloc(MASK_WIDTH * MASK_HEIGHT * 3);
  for (let index = 0; index < mask.length; index += 1) {
    const [red, green, blue] = mask[index] ? [inkR, inkG, inkB] : [paperR, paperG, paperB];
    rgb[index * 3] = red;
    rgb[index * 3 + 1] = green;
    rgb[index * 3 + 2] = blue;
  }

  return sharp(rgb, { raw: { width: MASK_WIDTH, height: MASK_HEIGHT, channels: 3 } })
    .resize(outWidth, outHeight, { kernel: "lanczos3" })
    // Flat art: quantise the anti-aliased edge back to paper and ink.
    .png({ palette: true, colours: 4, dither: 0 })
    .toBuffer();
}

export type AiSilhouetteOptions = {
  palette?: SilhouettePalette;
  /** Model that can edit an image, e.g. gemini-2.5-flash-image. */
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Prompt used for every poster so all five tiles share one flat paper-cut style. */
export function silhouettePrompt(palette: SilhouettePalette): string {
  return [
    "Turn this drama poster into flat 2D quiz art.",
    "Keep ONLY the main characters as one solid dark ink silhouette, in exactly the same pose and outfit.",
    "Remove every facial feature: no eyes, no nose, no mouth, no expression lines.",
    "Remove all text, lettering, titles, logos, watermarks and channel marks.",
    `Plain flat background in ${palette.paper}, no gradient, no photo texture, no shadow.`,
    "Hard vector edges, paper-cut style, square portrait composition.",
  ].join(" ");
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } };

/**
 * Draws the silhouette with an image model when one is configured, because heuristics
 * cannot reliably separate a subject from a busy poster. Returns null on any failure so
 * the caller can fall back to the local silhouette renderer.
 */
export async function renderAiSilhouette(
  source: Uint8Array | Buffer,
  options: AiSilhouetteOptions = {},
): Promise<Buffer | null> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = options.model ?? process.env.GEMINI_IMAGE_MODEL?.trim() ?? "gemini-2.5-flash-image";
  const base = process.env.GEMINI_API_BASE?.trim() || "https://generativelanguage.googleapis.com";
  const fetchImpl = options.fetchImpl ?? fetch;
  const palette = options.palette ?? SILHOUETTE_PALETTES[0]!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);

  try {
    const response = await fetchImpl(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: silhouettePrompt(palette) },
            { inline_data: { mime_type: "image/jpeg", data: Buffer.from(source).toString("base64") } },
          ],
        }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });

    if (!response.ok) {
      console.warn(`[quiz] silhouette model ${model} responded ${response.status}`);
      return null;
    }

    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inline = part.inlineData ?? part.inline_data;
      const data = inline?.data;
      if (!data) continue;
      const art = await sharp(Buffer.from(data, "base64")).rotate().png().toBuffer();
      const metadata = await sharp(art).metadata();
      if (!metadata.width || !metadata.height) continue;
      return art;
    }
    console.warn("[quiz] silhouette model returned no image part");
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`[quiz] silhouette model failed: ${message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
