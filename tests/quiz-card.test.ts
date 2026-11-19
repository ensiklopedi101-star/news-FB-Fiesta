import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  QUIZ_BRAND_CELL_INDEX,
  QUIZ_CARD_SIZE,
  QUIZ_CELL_HEIGHT,
  QUIZ_CELL_WIDTH,
  QUIZ_POSTER_CELLS,
  renderQuizCard,
} from "../src/lib/quiz-card";

async function tile(background: { r: number; g: number; b: number }) {
  // Portrait, like a real film/drama poster.
  return sharp({ create: { width: 60, height: 90, channels: 3, background } }).png().toBuffer();
}

async function pixel(output: Buffer, left: number, top: number) {
  return sharp(output).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
}

test("quiz card renders a 1080×1080 grid of five silhouettes plus the brand cell", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, (_, index) =>
    tile(index === 0 ? { r: 240, g: 40, b: 40 } : { r: 18, g: 22, b: 30 })));

  const output = await renderQuizCard({ tiles });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, QUIZ_CARD_SIZE);
  assert.equal(metadata.height, QUIZ_CARD_SIZE);
  assert.equal(QUIZ_POSTER_CELLS, 5);
  assert.equal(QUIZ_BRAND_CELL_INDEX, 5);

  // Poster cells are pastel paper, never the raw photo: the top-left corner of cell one is light.
  const paper = await pixel(output, 8, 8);
  assert.ok(paper[0]! > 180 && paper[1]! > 150, `sel poster harus kertas pastel (${[...paper]})`);

  // The bottom-right cell is the brand panel: dark, never a poster.
  const brand = await pixel(output, QUIZ_CELL_WIDTH + 40, QUIZ_CELL_HEIGHT * 2 + 40);
  assert.ok((brand[0]! + brand[1]! + brand[2]!) / 3 < 70, "sel merek harus gelap");
});

test("the brand cell carries the Popbeez logo and the Tebak Drama wording", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, () => tile({ r: 255, g: 255, b: 255 })));
  const output = await renderQuizCard({ tiles });

  // The logo sits near the top of the brand cell and is pink, unlike any pastel poster cell.
  const logo = await pixel(output, QUIZ_CELL_WIDTH + QUIZ_CELL_WIDTH / 2, QUIZ_CELL_HEIGHT * 2 + 78);
  assert.ok(logo[0]! > logo[1]! + 20, "logo Popbeez harus berwarna merah muda");

  // Yellow "TEBAK DRAMA" label line inside the brand cell.
  const labelBand = await sharp(output)
    .extract({ left: QUIZ_CELL_WIDTH, top: QUIZ_CELL_HEIGHT * 2 + 245, width: QUIZ_CELL_WIDTH, height: 34 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let yellow = 0;
  for (let offset = 0; offset < labelBand.length; offset += 3) {
    if (labelBand[offset]! > 200 && labelBand[offset + 1]! > 170 && labelBand[offset + 2]! < 120) yellow += 1;
  }
  assert.ok(yellow > 200, `label kuning tidak ditemukan (${yellow} piksel)`);
});

test("quiz card refuses to render with a missing poster", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS - 1 }, () => tile({ r: 20, g: 20, b: 20 })));
  await assert.rejects(() => renderQuizCard({ tiles }), /tepat 5 gambar, tersedia 4/);
});

test("quiz card numbers every poster cell so the caption can reference positions", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, () => tile({ r: 250, g: 250, b: 250 })));
  const output = await renderQuizCard({ tiles });

  // Badge 1 sits at the bottom-right of the first cell (514, 334); sample the disc, not the digit.
  const badge = await pixel(output, 502, 322);
  const paper = await pixel(output, 8, 8);
  assert.ok((badge[0]! + badge[1]! + badge[2]!) / 3 < 120, "badge nomor harus gelap");
  assert.ok(paper[0]! > 180, "kertas di sekitar badge tetap terang");
});

test("prepared silhouette art is fitted, never re-processed", async () => {
  const art = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#f7e7cf" } })
    .composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: "#ff0000" } }).png().toBuffer(), left: 40, top: 90 }])
    .png()
    .toBuffer();

  const output = await renderQuizCard({ tiles: Array.from({ length: QUIZ_POSTER_CELLS }, () => art), prepared: [true, true, true, true, true] });
  // The red block survives untouched in the middle of the first cell.
  const middle = await pixel(output, QUIZ_CELL_WIDTH / 2, QUIZ_CELL_HEIGHT / 2);
  assert.ok(middle[0]! > 150 && middle[1]! < 120, `art siap pakai tidak boleh diproses ulang (${[...middle]})`);
});
