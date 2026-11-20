import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { REEL_HEIGHT, REEL_WIDTH, renderReelFrame } from "@/lib/reel-frames";

test("frame Reel berukuran 1080x1920 dan bebas emoji", async () => {
  const png = await renderReelFrame(
    { text: "Rating drama ini tembus dua digit 🔥 dan jadi perbincangan.", seconds: 3 },
    { brand: "Popbeez", handle: "@portalbeez", voiceLabel: "Kritis", sourceName: "Soompi" },
    0,
  );
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, REEL_WIDTH);
  assert.equal(metadata.height, REEL_HEIGHT);
  assert.equal(metadata.format, "png");
  assert.ok(png.length > 10_000);
});

test("teks panjang tetap dirender tanpa melebihi kanvas", async () => {
  const long = "Drama korea terbaru ini menutup musim pertamanya dengan rating tertinggi tahun ini dan langsung memicu perdebatan soal ending terbuka yang dianggap terlalu dipaksakan oleh sebagian penonton setia.";
  const png = await renderReelFrame(
    { text: long, seconds: 4 },
    { brand: "Popbeez", handle: "@portalbeez", voiceLabel: "Industri", sourceName: "Soompi" },
    3,
  );
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, REEL_WIDTH);
  assert.equal(metadata.height, REEL_HEIGHT);
});
