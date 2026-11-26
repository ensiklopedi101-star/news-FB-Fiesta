import { z } from "zod";
import { isSafePublicImageUrl } from "./safe-url";

export const ARTIST_SEGMENTS = { artist_bio: "Bio Artis", artist_spotlight: "Sorotan Artis/Idol" } as const;
const publicUrl = z.string().trim().max(2000).url().refine(isSafePublicImageUrl, "Gunakan URL publik HTTPS.");
export const artistInputSchema = z.object({
  segment: z.enum(["artist_bio", "artist_spotlight"]),
  artist: z.string().trim().min(2).max(80),
  headline: z.string().trim().min(5).max(100),
  angle: z.string().trim().min(10).max(500),
  question: z.string().trim().min(10).max(200),
  rightsConfirmed: z.boolean().refine(Boolean, "Konfirmasi hak penggunaan keempat foto."),
  slides: z.array(z.object({
    heading: z.string().trim().min(3).max(55),
    fact: z.string().trim().min(10).max(220),
    sourceUrl: publicUrl.pipe(z.string().max(500)),
    imageUrl: publicUrl,
    imageSourceUrl: publicUrl.pipe(z.string().max(500)),
    credit: z.string().trim().min(2).max(45),
  })).length(4),
  caption: z.string().trim().max(10000).default(""),
});
export type ArtistInput = z.infer<typeof artistInputSchema>;

export function buildArtistCaption(input: ArtistInput): string {
  return [input.headline, ...input.slides.map((slide, i) => `${i + 1}. ${slide.heading}\n${slide.fact}`),
    `Menurut PopBeez, ${input.angle}`, `Beezers, ${input.question}`,
    "Sumber & kredit:", ...input.slides.map((slide, i) => `${i + 1}. ${slide.sourceUrl}\nFoto: ${slide.credit} · ${slide.imageSourceUrl}`),
    "#PopBeez #" + (input.segment === "artist_bio" ? "BioArtis" : "SorotanArtis")].join("\n\n");
}

export function canApproveArtist(row: { status: string; revision: number; previewRevision: number | null; previewUrls: string[] }): boolean {
  return row.status === "preview" && row.previewRevision === row.revision && row.previewUrls.length === 4;
}
export function canEditArtist(status: string): boolean {
  return ["draft", "preview"].includes(status);
}
