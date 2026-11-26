export const CONTENT_SEGMENTS = {
  roundup: { id: "roundup", label: "Roundup" },
  rating_drama_top_5: { id: "rating_drama_top_5", label: "Rating Drama Top 5" },
  rating_film_top_5: { id: "rating_film_top_5", label: "Rating Film Top 5" },
  rating_music_top_5: { id: "rating_music_top_5", label: "Rating Musik Top 5" },
  tebak_drama: { id: "tebak_drama", label: "Tebak Drama" },
  artis_bio: { id: "artis_bio", label: "Artis Bio" },
  reel: { id: "reel", label: "Reel" },
} as const;

export type ContentSegment = keyof typeof CONTENT_SEGMENTS;

export function ratingSegmentForMediaType(mediaType: string | null | undefined): ContentSegment {
  switch (mediaType?.trim().toLocaleUpperCase("id-ID")) {
    case "FILM": return "rating_film_top_5";
    case "MUSIK": return "rating_music_top_5";
    default: return "rating_drama_top_5";
  }
}

export const CONTENT_FORMATS = {
  single_image: { id: "single_image", label: "Gambar tunggal" },
  carousel: { id: "carousel", label: "Carousel" },
  quiz_grid: { id: "quiz_grid", label: "Grid kuis" },
  video: { id: "video", label: "Video" },
} as const;

export type ContentFormat = keyof typeof CONTENT_FORMATS;

export function contentSegmentLabel(segment: string | null | undefined): string {
  return segment && Object.hasOwn(CONTENT_SEGMENTS, segment)
    ? CONTENT_SEGMENTS[segment as ContentSegment].label
    : "Belum diklasifikasikan";
}

export function contentFormatLabel(format: string | null | undefined): string {
  return format && Object.hasOwn(CONTENT_FORMATS, format)
    ? CONTENT_FORMATS[format as ContentFormat].label
    : "Belum diklasifikasikan";
}
