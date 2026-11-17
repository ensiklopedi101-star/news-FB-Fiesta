/** Choose a distinct article image for factual carousel slides, falling back to the cover. */
export function imageForCarouselSlide(imageUrls: string[] | null | undefined, imageUrl: string | null, slideNumber: number): string | null {
  if (slideNumber > 1 && slideNumber < 4) return imageUrls?.[slideNumber - 1] ?? imageUrl;
  return imageUrl;
}
