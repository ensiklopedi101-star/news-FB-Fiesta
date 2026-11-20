import { sql } from "drizzle-orm";
import type { OriginalityReport } from "@/lib/originality";
import { pgEnum, pgTable, text, timestamp, uuid, integer, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const articleStatus = pgEnum("article_status", ["queued", "processing", "ready", "published", "failed", "expired", "removed"]);
export const articlePageKey = pgEnum("article_page_key", ["news", "entertainment"]);
export const articlePostFormat = pgEnum("article_post_format", ["single", "carousel"]);

export const rssSources = pgTable(
  "rss_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    pageKey: articlePageKey("page_key").notNull().default("news"),
    feedUrl: text("feed_url").notNull(),
    language: text("language").notNull().default("id"),
    active: boolean("active").notNull().default(true),
    keywords: text("keywords").array().notNull().default(sql`ARRAY[]::text[]`),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rss_sources_feed_url_unique").on(table.feedUrl),
    index("rss_sources_active_page_idx").on(table.active, table.pageKey),
  ],
);

export const articles = pgTable(
  "articles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceName: text("source_name").notNull(),
    category: text("category").notNull(),
    pageKey: articlePageKey("page_key").notNull().default("news"),
    sourceUrl: text("source_url").notNull(),
    urlHash: text("url_hash").notNull(),
    title: text("title").notNull(),
    originalTitle: text("original_title").notNull(),
    rawText: text("raw_text").notNull().default(""),
    imageUrl: text("image_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    manualImageUrls: jsonb("manual_image_urls").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    caption: text("caption"),
    /** Editorial analysis + opinion written for this post (the "substantial addition"). */
    editorialTake: text("editorial_take"),
    /** Standing editorial voice that wrote this post ("kritis", "santai", ...). */
    editorialVoice: text("editorial_voice"),
    /** Spoken script for the matching Reel; never shown in the caption. */
    narrationScript: text("narration_script"),
    /** Deterministic originality check attached to the caption (see lib/originality). */
    originalityScore: integer("originality_score").notNull().default(0),
    originalityNotes: jsonb("originality_notes").$type<OriginalityReport | null>(),
    status: articleStatus("status").notNull().default("queued"),
    facebookPostId: text("facebook_post_id"),
    /** Instagram media id when the post was mirrored to @popbeez.hive. */
    instagramMediaId: text("instagram_media_id"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    priorityAt: timestamp("priority_at", { withTimezone: true }),
    postFormat: articlePostFormat("post_format").notNull().default("single"),
    carouselSlides: jsonb("carousel_slides").$type<string[]>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("articles_url_hash_unique").on(table.urlHash),
    index("articles_status_created_idx").on(table.status, table.createdAt),
    index("articles_page_status_created_idx").on(table.pageKey, table.status, table.createdAt),
    index("articles_published_at_idx").on(table.publishedAt),
  ],
);

export const publisherState = pgTable("publisher_state", {
  id: integer("id").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull().default(sql`'epoch'::timestamptz`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shortLinks = pgTable(
  "short_links",
  {
    slug: text("slug").primaryKey(),
    targetUrl: text("target_url").notNull(),
    articleId: uuid("article_id"),
    clicks: integer("clicks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastClickedAt: timestamp("last_clicked_at", { withTimezone: true }),
  },
  (table) => [
    index("short_links_created_idx").on(table.createdAt),
    index("short_links_article_idx").on(table.articleId),
  ],
);

export const quizEditions = pgTable(
  "quiz_editions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    posterKeys: jsonb("poster_keys").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    reviewIds: jsonb("review_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    imageUrl: text("image_url"),
    caption: text("caption"),
    facebookPostId: text("facebook_post_id"),
    errorMessage: text("error_message"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("quiz_editions_created_idx").on(table.createdAt)],
);

export const reelStatus = pgEnum("reel_status", ["rendering", "published", "failed"]);

/** One Reel per article (latest attempt wins), rendered from narration + frames. */
export const reels = pgTable(
  "reels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    articleId: uuid("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    status: reelStatus("status").notNull().default("rendering"),
    narration: text("narration"),
    voiceLabel: text("voice_label"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    frameCount: integer("frame_count").notNull().default(0),
    videoUrl: text("video_url"),
    facebookVideoId: text("facebook_video_id"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("reels_article_idx").on(table.articleId),
    index("reels_created_idx").on(table.createdAt),
  ],
);

export type RssSource = typeof rssSources.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type QuizEdition = typeof quizEditions.$inferSelect;
export type Reel = typeof reels.$inferSelect;
