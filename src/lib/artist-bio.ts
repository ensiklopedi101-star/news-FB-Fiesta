import { z } from "zod";
import { isSafePublicImageUrl } from "@/lib/safe-url";
import { INSTAGRAM_HANDLE } from "@/lib/brand";
import { MANUAL_REVIEW_FOLLOW_COMMENT } from "@/lib/manual-review";
import { ARTIST_BIO_MAX_FACTS, ARTIST_BIO_MIN_FACTS } from "@/lib/artist-bio-constants";

export { ARTIST_BIO_MAX_FACTS, ARTIST_BIO_MIN_FACTS } from "@/lib/artist-bio-constants";

export const ARTIST_BIO_MARKER = "popbeez-artist-bio-v1";
export const ARTIST_BIO_SOURCE_NAME = "Artis Bio PopBeez";

export type ArtistBioFact = {
  fact: string;
  sourceUrl: string;
  imageUrl: string;
};

export type ArtistBio = {
  kind: typeof ARTIST_BIO_MARKER;
  name: string;
  facts: ArtistBioFact[];
};

const safeUrl = z.string().url().refine(isSafePublicImageUrl, "Gunakan URL HTTPS publik yang aman.");
export const artistBioInputSchema = z.object({
  name: z.string().trim().min(2).max(50),
  facts: z.array(z.object({
    fact: z.string().trim().min(12).max(140),
    sourceUrl: safeUrl,
    imageUrl: safeUrl,
  })).min(ARTIST_BIO_MIN_FACTS).max(ARTIST_BIO_MAX_FACTS),
}).strict();

export function createArtistBio(value: unknown): ArtistBio {
  const input = artistBioInputSchema.parse(value);
  return { kind: ARTIST_BIO_MARKER, name: input.name, facts: input.facts };
}

export function parseArtistBio(rawText: string): ArtistBio | null {
  try {
    const value = JSON.parse(rawText) as Partial<ArtistBio>;
    if (value.kind !== ARTIST_BIO_MARKER) return null;
    // The public input schema is strict; remove the persistence-only marker before validating it.
    const parsed = artistBioInputSchema.safeParse({ name: value.name, facts: value.facts });
    return parsed.success
      ? { kind: ARTIST_BIO_MARKER, name: parsed.data.name, facts: parsed.data.facts }
      : null;
  } catch {
    return null;
  }
}

export function artistBioHeadline(name: string): string {
  return `Kenalan dengan ${name.trim()}`.slice(0, 100);
}

/** Caption copy only frames the supplied facts; it never adds biographical claims. */
export function buildArtistBioCaption(bio: ArtistBio, options: { includeSources?: boolean } = {}): string {
  const caption = [
    `ARTIS BIO: ${bio.name}`,
    "",
    bio.facts.length === 1
      ? "Beezers, kenalan singkat dengan satu fakta yang sudah dilengkapi sumber. Mana yang baru kamu tahu?"
      : `Beezers, geser untuk ${bio.facts.length} fakta yang sudah dilengkapi sumber. Mana yang baru kamu tahu?`,
    "",
    `#ArtisBio #PopBeez #${INSTAGRAM_HANDLE.replace(/^@/, "")}`,
  ].join("\n");
  const sources = options.includeSources ? buildArtistBioSourceList(bio) : "";
  return sources ? `${caption}\n\n${sources}` : caption;
}

export function buildArtistBioSourceList(bio: ArtistBio): string {
  return `Sumber fakta Artis Bio — ${bio.name}:\n${bio.facts.map((item, index) => `${index + 1}. ${item.sourceUrl}`).join("\n")}`;
}

export function buildArtistBioSourceComment(bio: ArtistBio): string {
  return `${buildArtistBioSourceList(bio)}\n\n${MANUAL_REVIEW_FOLLOW_COMMENT}`;
}

/** Deterministic voiceover: the only biographical claims are the source-backed facts supplied by the editors. */
export function buildArtistBioNarration(bio: ArtistBio): string {
  return [
    `Beezers, kenalan dengan ${bio.name}.`,
    ...bio.facts.map((item) => item.fact),
    bio.facts.length === 1
      ? "Fakta ini bersumber dari tautan yang dicantumkan redaksi."
      : "Semua fakta bersumber dari tautan yang dicantumkan redaksi.",
    "Fakta mana yang paling baru buat kamu?",
  ].join(" ");
}
