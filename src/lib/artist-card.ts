import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ensureBundledFonts } from "./og-card";
import { circularLogoBuffer } from "./logo-circle";
import { ARTIST_SEGMENTS, type ArtistInput } from "./artist-content";
const xml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
function lines(text: string, size: number): string[] {
  // Split long unbroken strings too; all accepted input must fit the card.
  const words = text.split(/\s+/).flatMap(w => w.match(new RegExp(`.{1,${size}}`, "gu")) ?? []);
  const result: string[] = [];
  for (const word of words) {
    const last = result[result.length - 1];
    if (last && last.length + word.length + 1 <= size) result[result.length - 1] += " " + word;
    else result.push(word);
  }
  return result;
}
export async function renderArtistCard(content: ArtistInput, index: number, photo: Uint8Array): Promise<Buffer> {
  const slide = content.slides[index];
  if (!slide) throw new Error("Slide tidak valid.");
  await ensureBundledFonts();
  const background = await sharp(Buffer.from(photo)).rotate().resize(1080, 1080, { fit: "cover" }).png().toBuffer();
  const heading = lines(slide.heading, 28);
  const facts = lines(slide.fact, 44);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
    <rect width="1080" height="170" fill="#160c19" opacity=".86"/>
    <rect y="535" width="1080" height="545" fill="#160c19" opacity=".91"/>
    <g font-family="DejaVu Sans, sans-serif" fill="white">
      <text x="160" y="76" font-size="38" font-weight="bold">PopBeez</text>
      <text x="160" y="116" font-size="22">${xml(ARTIST_SEGMENTS[content.segment])} · ${index + 1}/4</text>
      <text x="55" y="575" font-size="23" fill="#ffd12e">${xml(content.artist)}</text>
      ${heading.map((s, i) => `<text x="55" y="${625 + i * 44}" font-size="38" font-weight="bold">${xml(s)}</text>`).join("")}
      ${facts.map((s, i) => `<text x="55" y="${750 + i * 35}" font-size="31">${xml(s)}</text>`).join("")}
      <text x="55" y="982" font-size="20">Foto: ${xml(slide.credit)}</text>
      <text x="55" y="1024" font-size="19">@popbeez.hive · facebook.com/portalbeez</text>
      <text x="1025" y="1024" text-anchor="end" font-size="18">powered by HIVECOMP</text>
    </g></svg>`);
  const logo = await circularLogoBuffer(await readFile(resolve(process.cwd(), "public/brand/popbeez_icon.png")), 96);
  return sharp(background).composite([{ input: svg }, { input: logo, left: 40, top: 30 }]).jpeg({ quality: 92 }).toBuffer();
}
