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

test("quiz card renders a 1080×1080 grid of recognizable poster crops plus the brand cell", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, (_, index) =>
    tile(index === 0 ? { r: 240, g: 40, b: 40 } : { r: 18, g: 22, b: 30 })));

  const output = await renderQuizCard({ tiles });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, QUIZ_CARD_SIZE);
  assert.equal(metadata.height, QUIZ_CARD_SIZE);
  assert.equal(QUIZ_POSTER_CELLS, 5);
  assert.equal(QUIZ_BRAND_CELL_INDEX, 5);

  // Recognizable poster color survives the crop and light vignette; it is no longer an abstract silhouette.
  const clue = await pixel(output, 8, 8);
  assert.ok(clue[0]! > 180 && clue[1]! < 90, `petunjuk poster asli harus tetap terlihat (${[...clue]})`);

  // The bottom-right cell is the brand panel: dark, never a poster.
  const brand = await pixel(output, QUIZ_CELL_WIDTH + 40, QUIZ_CELL_HEIGHT * 2 + 40);
  assert.ok((brand[0]! + brand[1]! + brand[2]!) / 3 < 70, "sel merek harus gelap");
});

test("the brand cell carries the PopBeez logo and the Tebak Drama wording", async () => {
  const tiles = await Promise.all(Array.from({ length: QUIZ_POSTER_CELLS }, () => tile({ r: 255, g: 255, b: 255 })));
  const output = await renderQuizCard({ tiles });

  // The logo sits near the top of the brand cell and is pink, unlike any pastel poster cell.
  // It is masked into a circle now, so scan the whole logo box for the brand pink.
  const logoBox = await sharp(output)
    .extract({ left: QUIZ_CELL_WIDTH + Math.round((QUIZ_CELL_WIDTH - 116) / 2), top: QUIZ_CELL_HEIGHT * 2 + 20, width: 116, height: 116 })
    .removeAlpha()
    .raw()
    .toBuffer();
  let pink = 0;
  for (let offset = 0; offset < logoBox.length; offset += 3) {
    if (logoBox[offset]! > 200 && logoBox[offset + 1]! < 140) pink += 1;
  }
  assert.ok(pink > 400, `logo PopBeez harus berwarna merah muda (${pink} piksel pink)`);

  // Yellow "TEBAK DRAMA" label line inside the brand cell.
  const labelBand = await sharp(output)
    .extract({ left: QUIZ_CELL_WIDTH, top: QUIZ_CELL_HEIGHT * 2 + 218, width: QUIZ_CELL_WIDTH, height: 32 })
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

test("quiz card crops poster title and footer bands while retaining central artwork", async () => {
  const poster = await sharp({ create: { width: 120, height: 180, channels: 3, background: "#2456c4" } })
    .composite([
      { input: await sharp({ create: { width: 120, height: 28, channels: 3, background: "#ed3434" } }).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp({ create: { width: 120, height: 36, channels: 3, background: "#24a45b" } }).png().toBuffer(), left: 0, top: 144 },
    ])
    .png()
    .toBuffer();
  const output = await renderQuizCard({ tiles: Array.from({ length: QUIZ_POSTER_CELLS }, () => poster) });
  const centralArtwork = await pixel(output, Math.floor(QUIZ_CELL_WIDTH / 2), Math.floor(QUIZ_CELL_HEIGHT / 2));
  assert.ok(centralArtwork[2]! > centralArtwork[0]!, `karya tengah poster harus dikenali (${[...centralArtwork]})`);

  const topBand = await pixel(output, 15, 15);
  const footerBand = await pixel(output, 15, QUIZ_CELL_HEIGHT - 15);
  assert.ok(topBand[2]! > topBand[0]!, `pita judul poster di bagian atas harus terpotong (${[...topBand]})`);
  assert.ok(footerBand[2]! > footerBand[1]!, `pita footer poster di bagian bawah harus terpotong (${[...footerBand]})`);
});
