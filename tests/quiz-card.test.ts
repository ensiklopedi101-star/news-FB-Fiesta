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

async function probe(output: Buffer, left: number, top: number) {
  const [red, green, blue] = await sharp(output).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  return { red: red!, green: green!, blue: blue!, average: (red! + green! + blue!) / 3 };
}

test("quiz card renders a 1080×1080 grid of five posters plus the brand cell", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, (_, index) =>
    tile(index === 0 ? { r: 240, g: 40, b: 40 } : { r: 18, g: 22, b: 30 })));

  const output = await renderQuizCard({ tiles });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, QUIZ_CARD_SIZE);
  assert.equal(metadata.height, QUIZ_CARD_SIZE);
  assert.equal(QUIZ_POSTER_CELLS, 5);
  assert.equal(QUIZ_BRAND_CELL_INDEX, 5);

  // First cell carries the red poster, so the middle of the cell stays red.
  const firstTile = await probe(output, QUIZ_CELL_WIDTH / 2, QUIZ_CELL_HEIGHT / 2);
  assert.ok(firstTile.red > 150 && firstTile.red > firstTile.green + 40, "poster pertama harus merah");

  // The bottom-right cell is the brand panel: dark, never a poster.
  const brand = await probe(output, QUIZ_CELL_WIDTH + 40, QUIZ_CELL_HEIGHT * 2 + 40);
  assert.ok(brand.average < 70, "sel merek harus gelap");
});

test("the brand cell carries the Popbeez logo and the Tebak Drama wording", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, () => tile({ r: 255, g: 255, b: 255 })));
  const output = await renderQuizCard({ tiles });

  // The logo sits near the top of the brand cell and is pink, unlike any white poster cell.
  const logo = await probe(output, QUIZ_CELL_WIDTH + QUIZ_CELL_WIDTH / 2, QUIZ_CELL_HEIGHT * 2 + 78);
  assert.ok(logo.red > logo.green + 20, "logo Popbeez harus berwarna merah muda");

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

  // Badge 1 sits at the bottom-right corner of the first cell (514 ± 26, 334 ± 26); sample inside its dark disc.
  assert.ok((await probe(output, 503, 323)).average < 140, "badge nomor harus gelap di atas poster terang");
  assert.ok((await probe(output, QUIZ_CELL_WIDTH / 2, QUIZ_CELL_HEIGHT / 2)).average > 200, "area poster di luar badge harus tetap terang");
});
