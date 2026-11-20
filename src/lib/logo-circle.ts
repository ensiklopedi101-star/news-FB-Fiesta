import sharp from "sharp";

/**
 * Draws a page logo as a circle, whatever shape the uploaded asset has.
 *
 * The uploaded PopBeez logo is a **white square** with the round emblem floating
 * inside it, so a naive circular mask still leaves a white ring and square corners.
 * This helper finds the actual emblem bounds first (anything that is neither
 * transparent nor plain white), crops to that box, and only then applies the
 * circular mask plus a hairline ring so it reads cleanly on every background.
 */
const NEAR_WHITE = 238;
const ALPHA_FLOOR = 16;

export async function circularLogoBuffer(input: Buffer, size: number): Promise<Buffer> {
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const alpha = data[offset + 3] ?? 255;
      if (alpha < ALPHA_FLOOR) continue;
      const r = data[offset] ?? 0;
      const g = data[offset + 1] ?? 0;
      const b = data[offset + 2] ?? 0;
      if (r > NEAR_WHITE && g > NEAR_WHITE && b > NEAR_WHITE) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }

  const hasInk = right > left && bottom > top;
  const box = hasInk
    ? { left, top, width: right - left + 1, height: bottom - top + 1 }
    : { left: 0, top: 0, width: info.width, height: info.height };

  const square = await sharp(input, { limitInputPixels: 40_000_000 })
    .extract(box)
    .resize(size, size, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Punch the circular alpha ourselves: blend-mode masks behave differently across
  // sharp/libvips builds, while pixel alpha is deterministic.
  const channels = square.info.channels;
  const pixels = square.data;
  const radius = size / 2;
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      const alphaOffset = (y * size + x) * channels + 3;
      let factor = 0;
      if (distance <= radius - 1.5) factor = 1;
      else if (distance < radius) factor = (radius - distance) / 1.5;
      pixels[alphaOffset] = Math.round((pixels[alphaOffset] ?? 255) * factor);
    }
  }

  const ring = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${radius}" cy="${radius}" r="${radius - 1.5}" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="2"/></svg>`);
  return sharp(pixels, { raw: { width: size, height: size, channels } })
    .composite([{ input: ring }])
    .png()
    .toBuffer();
}
