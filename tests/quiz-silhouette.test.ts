import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { renderSilhouette, SILHOUETTE_HEIGHT, SILHOUETTE_WIDTH, silhouettePalette } from "../src/lib/quiz-silhouette";

/** A stand-in poster: bright paper, a dark figure in the middle, and a title bar at the top. */
async function syntheticPoster() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900">
    <rect width="600" height="900" fill="#f5f5f5"/>
    <rect x="0" y="60" width="600" height="90" fill="#101010"/>
    <text x="300" y="135" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="80" font-weight="900" fill="#101010">TITLE</text>
    <circle cx="300" cy="470" r="110" fill="#1b1b1b"/>
    <rect x="240" y="560" width="120" height="230" rx="30" fill="#1b1b1b"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixel(image: Buffer, left: number, top: number) {
  return sharp(image).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
}

test("silhouette art keeps only paper and ink", async () => {
  const art = await renderSilhouette(await syntheticPoster(), { palette: silhouettePalette(0) });
  const metadata = await sharp(art).metadata();
  assert.equal(metadata.width, SILHOUETTE_WIDTH);
  assert.equal(metadata.height, SILHOUETTE_HEIGHT);

  const { data, info } = await sharp(art).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set<string>();
  for (let offset = 0; offset < data.length; offset += info.channels) {
    colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
  }
  // Flat art: paper, ink, and the thin anti-aliased edge between them — never a photo.
  assert.ok(colors.size <= 8, `warna terlalu banyak: ${colors.size}`);

  let ink = 0;
  const palette = silhouettePalette(0);
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const rgb = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
    if (rgb !== "247,231,207" && rgb !== "23,18,28") {
      // Intermediate edge pixels are fine; count only near-ink pixels as ink.
      if (data[offset]! < 90) ink += 1;
    } else if (rgb === "23,18,28") {
      ink += 1;
    }
  }
  const share = ink / (info.width * info.height);
  assert.ok(share > 0.04 && share < 0.7, `bagian tinta tidak wajar: ${share.toFixed(3)}`);
  assert.equal(palette.ink, "#17121c");
});

test("silhouette art never keeps the poster title band", async () => {
  const art = await renderSilhouette(await syntheticPoster(), { palette: silhouettePalette(0) });
  const metadata = await sharp(art).metadata();
  const height = metadata.height ?? SILHOUETTE_HEIGHT;
  // The very top of the tile is paper, whatever the poster printed there.
  const top = await pixel(art, 4, 2);
  assert.ok(top[0]! > 200, `baris atas harus kertas, bukan tinta (${[...top]})`);
  const bottom = await pixel(art, 4, height - 3);
  assert.ok(bottom[0]! > 200, `baris bawah harus kertas, bukan tinta (${[...bottom]})`);
});

test("a poster with no separable artwork still yields a filled paper tile", async () => {
  const flat = await sharp({ create: { width: 600, height: 900, channels: 3, background: "#8a8a8a" } }).png().toBuffer();
  const art = await renderSilhouette(flat, { palette: silhouettePalette(1) });
  const metadata = await sharp(art).metadata();
  assert.equal(metadata.width, SILHOUETTE_WIDTH);
  const corner = await pixel(art, 2, 2);
  assert.ok(corner[0]! > 150 || corner[0]! < 60, "sel harus terisi, bukan transparan");
});

test("silhouette prompt forbids faces and titles", async () => {
  const { silhouettePrompt } = await import("../src/lib/quiz-silhouette");
  const prompt = silhouettePrompt(silhouettePalette(0));
  assert.ok(/no eyes, no nose, no mouth/i.test(prompt));
  assert.ok(/remove all text/i.test(prompt));
  assert.ok(prompt.includes("#f7e7cf"));
});

test("the image model is skipped without an API key and falls back cleanly", async () => {
  const { renderAiSilhouette } = await import("../src/lib/quiz-silhouette");
  const art = await renderAiSilhouette(Buffer.from("poster"), { apiKey: "" });
  assert.equal(art, null);
});

test("a model reply that carries an inline image is decoded", async () => {
  const { renderAiSilhouette } = await import("../src/lib/quiz-silhouette");
  const drawn = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#f7e7cf" } }).png().toBuffer();
  const fakeFetch = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ inline_data: { mime_type: "image/png", data: drawn.toString("base64") } }] } }],
  }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

  const art = await renderAiSilhouette(Buffer.from("poster"), { apiKey: "test", fetchImpl: fakeFetch });
  assert.ok(art && art.byteLength > 0);
  const metadata = await sharp(art!).metadata();
  assert.equal(metadata.width, 32);
});

test("a failing model reply returns null so the local renderer takes over", async () => {
  const { renderAiSilhouette } = await import("../src/lib/quiz-silhouette");
  const fakeFetch = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  assert.equal(await renderAiSilhouette(Buffer.from("poster"), { apiKey: "test", fetchImpl: fakeFetch }), null);
});
