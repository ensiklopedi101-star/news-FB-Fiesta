import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { renderOgCard } from "../src/lib/og-card";

const baseOptions = {
  brand: "Nusabeez",
  category: "NASIONAL",
  title: "Judul berita dengan karakter khusus < aman & diuji sebagai SVG text",
  sourceName: "Sumber Berita",
  isEntertainment: false,
};

test("Sharp card renderer outputs a complete JPEG and composites the source photo", async () => {
  const greenPhoto = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 20, g: 210, b: 70 } },
  }).png().toBuffer();
  const output = await renderOgCard({ ...baseOptions, photoJpeg: greenPhoto });
  const metadata = await sharp(output).metadata();
  const centerPhotoPixel = await sharp(output)
    .extract({ left: 540, top: 400, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
  assert.ok(centerPhotoPixel[1]! > centerPhotoPixel[0]! * 2);
  assert.ok(centerPhotoPixel[1]! > centerPhotoPixel[2]!);
});

test("Sharp card renderer creates the branded fallback without a source photo", async () => {
  const output = await renderOgCard({ ...baseOptions, photoJpeg: null });
  const metadata = await sharp(output).metadata();
  const centerFallbackPixel = await sharp(output)
    .extract({ left: 540, top: 400, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
  assert.ok(centerFallbackPixel.some((channel) => channel > 0));
});

test("entertainment cards load the existing Popbeez logo asset", async () => {
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "ENTERTAINMENT",
    isEntertainment: true,
    photoJpeg: null,
  });
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
});
