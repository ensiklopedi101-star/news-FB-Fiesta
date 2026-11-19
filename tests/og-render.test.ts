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

test("composes two manually supplied photos side-by-side into one news card", async () => {
  const redPhoto = await sharp({ create: { width: 30, height: 40, channels: 3, background: { r: 220, g: 25, b: 25 } } }).png().toBuffer();
  const bluePhoto = await sharp({ create: { width: 30, height: 40, channels: 3, background: { r: 25, g: 45, b: 220 } } }).png().toBuffer();
  const output = await renderOgCard({ ...baseOptions, photoJpeg: redPhoto, photoJpegSecondary: bluePhoto });
  const left = await sharp(output).extract({ left: 250, top: 350, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const right = await sharp(output).extract({ left: 800, top: 350, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.ok(left[0]! > left[2]! * 2);
  assert.ok(right[2]! > right[0]! * 2);
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

test("renders a carousel information slide as a square branded JPEG", async () => {
  const output = await renderOgCard({
    ...baseOptions,
    photoJpeg: null,
    slide: { number: 2, total: 4, label: "FAKTA UTAMA", text: "Dua fakta singkat dari sumber untuk menjaga slide tetap mudah dibaca." },
  });
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
});

test("entertainment single-image cards show a Facebook follow CTA in the footer", async () => {
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "DRAMA",
    isEntertainment: true,
    photoJpeg: null,
  });
  const iconPixel = await sharp(output)
    .extract({ left: 774, top: 978, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();

  assert.ok(iconPixel[2]! > iconPixel[0]! * 2);
  assert.ok(iconPixel[2]! > iconPixel[1]!);
});

test("carousel follow CTA slide renders the Facebook icon", async () => {
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "DRAMA",
    isEntertainment: true,
    photoJpeg: null,
    slide: { number: 4, total: 4, label: "IKUTI POPBEEZ", isFollowCta: true },
  });
  const iconPixel = await sharp(output)
    .extract({ left: 505, top: 612, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();

  assert.ok(iconPixel[2]! > iconPixel[0]! * 2);
  assert.ok(iconPixel[2]! > iconPixel[1]!);
});

test("renders a unified manual review slide with the poster in a framed panel", async () => {
  const photo = await sharp({
    create: { width: 40, height: 80, channels: 3, background: { r: 20, g: 90, b: 210 } },
  }).png().toBuffer();
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "DRAMA",
    isEntertainment: true,
    photoJpeg: photo,
    reviewSlide: {
      number: 2,
      total: 6,
      headline: "5 Drama Rating Tertinggi Minggu Ini",
      mediaType: "DRAMA",
      item: { title: "Drama Peringkat Satu", rating: 9.4, genre: "Romansa, Komedi", reason: "Cerita dan chemistry pemeran utamanya menarik.", suitableFor: "Pencinta drama ringan.", imageUrl: "https://images.example.test/drama.jpg" },
    },
  });
  const metadata = await sharp(output).metadata();
  const photoPixel = await sharp(output).extract({ left: 800, top: 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1080);
  assert.ok(photoPixel[2]! > photoPixel[0]! * 2);
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

test("review slide keeps a long uppercase title inside the dark panel and preserves the poster", async () => {
  const photo = await sharp({
    create: { width: 40, height: 80, channels: 3, background: { r: 20, g: 190, b: 90 } },
  }).png().toBuffer();
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "DRAMA",
    isEntertainment: true,
    photoJpeg: photo,
    reviewSlide: {
      number: 3,
      total: 6,
      headline: "5 Drama Rating Tertinggi Minggu Ini",
      mediaType: "DRAMA",
      item: { title: "Drama Dengan Judul Sangat Panjang Sekali Tanpa Henti", rating: 9.1, genre: "Romansa", reason: "", suitableFor: "", imageUrl: "https://images.example.test/long.jpg" },
    },
  });
  const borderPixel = await sharp(output).extract({ left: 585, top: 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const photoPixel = await sharp(output).extract({ left: 900, top: 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  assert.ok(photoPixel[1]! > photoPixel[0]! * 2);
  assert.ok(photoPixel[1]! > photoPixel[2]! * 2);
  assert.ok(borderPixel[0]! < 60 && borderPixel[1]! < 60 && borderPixel[2]! < 60);
});

test("review cover uses a plain pink panel without a poster and shows the Popbeez logo", async () => {
  const photo = await sharp({
    create: { width: 40, height: 80, channels: 3, background: { r: 20, g: 190, b: 90 } },
  }).png().toBuffer();
  const output = await renderOgCard({
    ...baseOptions,
    brand: "Popbeez",
    category: "DRAMA",
    isEntertainment: true,
    photoJpeg: photo,
    reviewSlide: { number: 1, total: 6, headline: "5 Drama Rating Tertinggi Minggu Ini", mediaType: "DRAMA" },
  });
  const panelPixel = await sharp(output).extract({ left: 800, top: 500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const logoPixel = await sharp(output).extract({ left: 100, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer();

  // Plain pink panel, not the green source photo.
  assert.ok(panelPixel[0]! > panelPixel[1]! * 2);
  // The bee logo is composited over the black text panel.
  assert.ok(logoPixel[0]! + logoPixel[1]! + logoPixel[2]! > 120);
});

test("entertainment cards drop the kicker line while news cards keep theirs", async () => {
  const darkPhoto = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 8, g: 8, b: 10 } } }).png().toBuffer();
  const entertainment = await renderOgCard({
    brand: "Popbeez",
    category: "K-ENTERTAINMENT",
    title: "Drama sejarah Korea kembali meramaikan layar",
    sourceName: "Korea Times",
    isEntertainment: true,
    photoJpeg: darkPhoto,
  });
  const news = await renderOgCard({ ...baseOptions, photoJpeg: darkPhoto });

  const brightPixels = async (image: Buffer) => {
    const { data, info } = await sharp(image)
      .extract({ left: 300, top: 300, width: 480, height: 70 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let count = 0;
    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index]! > 200 && data[index + 1]! > 200 && data[index + 2]! > 200) count += 1;
    }
    return count;
  };

  // The band where "SOROTAN HIBURAN" used to sit must stay empty on Popbeez cards.
  assert.equal(await brightPixels(entertainment), 0);
  assert.ok(await brightPixels(news) > 0);
});
