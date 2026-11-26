import "server-only";
import { and, desc, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { articles } from "./schema";
import { MANUAL_REVIEW_SOURCE_NAMES, parseManualReview, type ManualReviewItem } from "./manual-review";
import type { QuizReview } from "./quiz";

/** Newest manual reviews first; each review contributes up to five posters (pool for many editions). */
export async function loadQuizReviews(): Promise<QuizReview[]> {
  const rows = await getDb().select({ id: articles.id, rawText: articles.rawText, createdAt: articles.createdAt })
    .from(articles)
    .where(and(
      inArray(articles.sourceName, [...MANUAL_REVIEW_SOURCE_NAMES]),
      inArray(articles.status, ["ready", "published"]),
    ))
    .orderBy(desc(articles.createdAt))
    .limit(24);

  const reviews: QuizReview[] = [];
  for (const row of rows) {
    const review = parseManualReview(row.rawText);
    if (!review) continue;
    reviews.push({
      id: row.id,
      createdAt: row.createdAt,
      items: review.items.map((item: ManualReviewItem) => ({ title: item.title, imageUrl: item.imageUrl })),
    });
  }
  return reviews;
}
