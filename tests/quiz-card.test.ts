import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { QUIZ_CARD_SIZE, QUIZ_TILE_COUNT, renderQuizCard } from "../src/lib/quiz-card";

async function tile(background: { r: number; g: number; b: number }) {
  return sharp({ create: { width: 40, height: 60, channels: 3, background } }).png().toBuffer();
}

test("quiz card renders a 1080×1080 grid of twelve tiles", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_TILE_COUNT }, (_, index) =>
    tile(index === 0 ? { r: 240, g: 40, b: 40 } : { r: 18, g: 22, b: 30 })));

  const output = await renderQuizCard({ tiles });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, QUIZ_CARD_SIZE);
  assert.equal(metadata.height, QUIZ_CARD_SIZE);

  const firstTile = await sharp(output).extract({ left: 135, top: 180, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const lastTile = await sharp(output).extract({ left: 945, top: 900, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.ok(firstTile[0]! > 180, "tile pertama harus merah terang");
  assert.ok(lastTile[0]! < 80, "tile terakhir harus gelap");
});

test("quiz card refuses to render with a missing tile", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_TILE_COUNT - 1 }, () => tile({ r: 20, g: 20, b: 20 })));
  await assert.rejects(() => renderQuizCard({ tiles }), /tepat 12 gambar, tersedia 11/);
});

test("quiz card numbers every tile so the caption can reference positions", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_TILE_COUNT }, () => tile({ r: 250, g: 250, b: 250 })));
  const output = await renderQuizCard({ tiles });

  const probe = async (left: number, top: number) => {
    const [red, green, blue] = await sharp(output).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    return (red! + green! + blue!) / 3;
  };

  // Badge 1 lives at the bottom-right corner of the first tile (248 ± 22, 338 ± 22); sample inside its dark disc.
  assert.ok((await probe(237, 327)) < 140, "badge nomor harus gelap di atas poster terang");
  assert.ok((await probe(135, 180)) > 200, "area poster di luar badge harus tetap terang");
});
