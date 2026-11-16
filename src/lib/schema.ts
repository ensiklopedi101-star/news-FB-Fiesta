import { pgEnum, pgTable, text, timestamp, uuid, integer, uniqueIndex, index } from "drizzle-orm/pg-core";

export const articleStatus = pgEnum("article_status", ["queued", "processing", "ready", "published", "failed"]);
export const articlePageKey = pgEnum("article_page_key", ["news", "entertainment"]);

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
    caption: text("caption"),
    status: articleStatus("status").notNull().default("queued"),
    facebookPostId: text("facebook_post_id"),
    errorMessage: text("error_message"),
    attempts: integer("attempts").notNull().default(0),
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

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
