import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { circularLogoBuffer } from "../src/lib/logo-circle";

/** The uploaded PopBeez logo: a white square card with a round emblem floating inside. */
async function whiteSquareLogo(): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 320, channels: 3, background: "#ffffff" } })
    .composite([{
      input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><circle cx="160" cy="160" r="96" fill="#ff2f7a"/></svg>'),
    }])
    .png()
    .toBuffer();
}

async function alphaAt(image: Buffer, x: number, y: number): Promise<number> {
  const pixel = await sharp(image).extract({ left: x, top: y, width: 1, height: 1 }).raw().toBuffer();
  return pixel[3] ?? 255;
}

test("a square logo is trimmed and masked into a circle", async () => {
  const circle = await circularLogoBuffer(await whiteSquareLogo(), 96);
  const metadata = await sharp(circle).metadata();

  assert.equal(metadata.width, 96);
  assert.equal(metadata.height, 96);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(await alphaAt(circle, 0, 0), 0, "corner must be transparent, never a white box");
  assert.equal(await alphaAt(circle, 0, 95), 0);
  assert.ok((await alphaAt(circle, 48, 48)) > 200, "the emblem centre stays opaque");
});

test("the circle hugs the emblem instead of keeping the flat white border", async () => {
  const circle = await circularLogoBuffer(await whiteSquareLogo(), 96);
  // With the border trimmed, the pink emblem reaches close to the circular edge.
  const edge = await sharp(circle).extract({ left: 88, top: 48, width: 4, height: 1 }).raw().toBuffer();
  const reds = [edge[0], edge[4], edge[8], edge[12]];
  assert.ok(reds.some((red) => (red ?? 0) > 150), "the emblem should fill the masked circle");
});
