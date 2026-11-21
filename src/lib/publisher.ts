import "server-only";
import { enqueueBufferFacebookPost } from "@/lib/buffer";
import { publishFacebookPagePost, usesDirectFacebookPublishing, type PageKey } from "@/lib/facebook";

export type PublishProvider = "buffer" | "facebook";

export type PublishResult = {
  provider: PublishProvider;
  postId: string;
  mediaFormat: "single" | "carousel";
};

export { usesDirectFacebookPublishing } from "@/lib/facebook";

/**
 * The entertainment page (PopBeez) can publish straight to Facebook when its
 * Page Access Token and Page ID are configured. News keeps using Buffer, and
 * entertainment falls back to Buffer until the Graph credentials exist.
 */

export async function publishPost(input: {
  pageKey: PageKey;
  imageUrl: string;
  imageUrls: string[];
  caption: string;
  strictCarousel?: boolean;
}): Promise<PublishResult> {
  if (usesDirectFacebookPublishing(input.pageKey)) {
    const result = await publishFacebookPagePost({
      pageKey: input.pageKey,
      imageUrls: input.imageUrls,
      caption: input.caption,
    });
    return { provider: "facebook", ...result };
  }

  const result = await enqueueBufferFacebookPost({
    pageKey: input.pageKey,
    imageUrl: input.imageUrl,
    imageUrls: input.imageUrls,
    caption: input.caption,
    strictCarousel: input.strictCarousel,
  });
  return { provider: "buffer", ...result };
}
