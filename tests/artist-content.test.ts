import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { artistInputSchema, buildArtistCaption, canApproveArtist, canEditArtist, type ArtistInput } from "../src/lib/artist-content";
import { renderArtistCard } from "../src/lib/artist-card";
function input(): ArtistInput {
  return { segment: "artist_bio", artist: "Artis Contoh", headline: "Mengenal perjalanan Artis Contoh", angle: "perubahan pilihan peran ini menarik dibahas", question: "karya mana yang paling kalian ingat?", rightsConfirmed: true, caption: "",
    slides: Array.from({ length: 4 }, (_, i) => ({ heading: `Perjalanan ${i + 1}`, fact: "Bahan contoh dari editor untuk pengujian saja, bukan fakta artis nyata.", sourceUrl: "https://example.com/facts", imageUrl: `https://example.com/${i}.jpg`, imageSourceUrl: "https://example.com/photos", credit: "Fotografer Contoh" })) };
}
test("both artist segments require exactly four sourced and credited photos", () => {
  const data = input();
  assert.ok(artistInputSchema.safeParse(data).success);
  assert.ok(artistInputSchema.safeParse({ ...data, segment: "artist_spotlight" }).success);
  for (const count of [0, 3, 5]) assert.equal(artistInputSchema.safeParse({ ...data, slides: Array.from({ length: count }, () => data.slides[0]) }).success, false);
  for (const field of ["sourceUrl", "imageUrl", "imageSourceUrl", "credit", "fact"] as const) {
    const invalid = input(); invalid.slides[0][field] = "";
    assert.equal(artistInputSchema.safeParse(invalid).success, false, field);
  }
  assert.equal(artistInputSchema.safeParse({ ...data, rightsConfirmed: false }).success, false);
});
test("private and insecure URLs are rejected before image fetching", () => {
  for (const url of ["http://example.com/a.jpg", "https://127.0.0.1/a.jpg", "https://10.0.0.1/a.jpg", "https://localhost/a.jpg", "https://user:password@example.com/a.jpg"]) {
    const data = input(); data.slides[0].imageUrl = url;
    assert.equal(artistInputSchema.safeParse(data).success, false);
  }
});
test("deterministic caption uses supplied facts, editorial angle, sources and credits in slide order", () => {
  const data = artistInputSchema.parse(input());
  const caption = buildArtistCaption(data);
  assert.ok(caption.includes(data.headline));
  assert.ok(caption.includes(`Menurut PopBeez, ${data.angle}`));
  assert.ok(caption.includes("Beezers"));
  assert.ok(caption.includes(data.slides[0].sourceUrl));
  assert.ok(caption.includes(data.slides[0].credit));
  assert.ok(caption.indexOf("1. Perjalanan 1") < caption.indexOf("4. Perjalanan 4"));
});
test("only the latest complete preview can be approved, never old revisions or repeated publication", () => {
  const row = { status: "preview", revision: 2, previewRevision: 2, previewUrls: ["a", "b", "c", "d"] };
  assert.equal(canApproveArtist(row), true);
  for (const status of ["draft", "rendering", "publishing", "published", "failed"]) assert.equal(canApproveArtist({ ...row, status }), false);
  assert.equal(canApproveArtist({ ...row, previewRevision: 1 }), false);
  assert.equal(canApproveArtist({ ...row, previewRevision: null }), false);
  assert.equal(canApproveArtist({ ...row, previewUrls: ["a", "b", "c"] }), false);
  assert.equal(canEditArtist("preview"), true);
  assert.equal(canEditArtist("draft"), true);
  for (const status of ["rendering", "publishing", "published", "failed"]) assert.equal(canEditArtist(status), false);
});
test("artist card renders all four slides as square JPEGs with required photo", async () => {
  const photo = await sharp({ create: { width: 800, height: 1200, channels: 3, background: "#bb3355" } }).png().toBuffer();
  const data = input(); data.slides[0].heading = 'Nama & karya <contoh> "aman"';
  for (let index = 0; index < 4; index++) {
    const output = await renderArtistCard(data, index, photo);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 1080); assert.equal(metadata.height, 1080);
  }
  await assert.rejects(() => renderArtistCard(data, 4, photo));
  await assert.rejects(() => renderArtistCard(data, 0, Buffer.from("bad image")));
});
