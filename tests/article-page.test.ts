import assert from "node:assert/strict";
import { test } from "node:test";
import { extractArticlePageData, MAX_ARTICLE_PAGE_HTML_BYTES, MAX_ARTICLE_SNIPPET_CHARS, readLimitedHtml } from "../src/lib/article-page";

test("extracts at most two article paragraphs and resolves a safe og:image", () => {
  const html = `
    <html><head><meta property="og:image" content="/images/story.jpg"></head>
      <body>
        <nav><p>Navigation text that must not enter the news summary.</p></nav>
        <article>
          <p>Paragraf pertama cukup panjang dan berisi fakta utama yang perlu dipertahankan untuk ringkasan berita.</p>
          <p>Paragraf kedua memberikan rincian tambahan yang tersedia di artikel tanpa menambah informasi lain.</p>
          <p>Paragraf ketiga seharusnya tidak ikut diambil karena batas ekstraksi hanya dua paragraf.</p>
        </article>
      </body>
    </html>`;
  const result = extractArticlePageData(html, "https://news.example/article");

  assert.equal(result.imageUrl, "https://news.example/images/story.jpg");
  assert.deepEqual(result.imageUrls, ["https://news.example/images/story.jpg"]);
  assert.match(result.text ?? "", /Paragraf pertama/);
  assert.match(result.text ?? "", /Paragraf kedua/);
  assert.doesNotMatch(result.text ?? "", /Paragraf ketiga|Navigation text/);
  assert.equal(result.text?.split("\n\n").length, 2);
});

test("extracts distinct in-article photos while ignoring logos, ads, and tiny decorations", () => {
  const html = `<head><meta property="og:image" content="/photos/hero.jpg"></head><body>
    <img src="/logos/publisher-logo.png" alt="publisher logo">
    <article><img src="/photos/second.jpg" width="900" height="600" alt="witness at scene">
      <img src="/ads/banner.jpg" width="900" height="600"><img src="/photos/third.jpg" width="900" height="600">
      <img src="/photos/tiny.jpg" width="32" height="32">
      <p>Paragraf berita ini cukup panjang untuk menjelaskan isi artikel dan menguji pemilihan gambar yang relevan.</p>
    </article>
  </body>`;
  const result = extractArticlePageData(html, "https://news.example/story");
  assert.deepEqual(result.imageUrls, ["https://news.example/photos/hero.jpg", "https://news.example/photos/second.jpg", "https://news.example/photos/third.jpg"]);
});

test("keeps metadata from the bounded HTML prefix when a publisher page exceeds the read limit", async () => {
  const prefix = '<html><head><meta property="og:image" content="https://cdn.example/soompi-cover.jpg"></head><body>';
  const oversizedHtml = `${prefix}${"x".repeat(MAX_ARTICLE_PAGE_HTML_BYTES + 100)}`;
  const response = new Response(oversizedHtml, {
    headers: { "content-type": "text/html", "content-length": String(Buffer.byteLength(oversizedHtml)) },
  });
  const partialHtml = await readLimitedHtml(response);
  assert.ok(partialHtml);
  assert.equal(Buffer.byteLength(partialHtml), MAX_ARTICLE_PAGE_HTML_BYTES);
  assert.equal(extractArticlePageData(partialHtml, "https://www.soompi.com/article/example").imageUrl, "https://cdn.example/soompi-cover.jpg");
});

test("caps extracted article text at 1,500 characters", () => {
  const paragraph = "Kalimat isi berita yang cukup panjang. ".repeat(40);
  const html = `<article><p>${paragraph}</p><p>${paragraph}</p></article>`;
  const result = extractArticlePageData(html, "https://news.example/article");

  assert.ok(result.text);
  assert.ok(result.text.length <= MAX_ARTICLE_SNIPPET_CHARS);
});

test("rejects insecure and credential-bearing og:image URLs", () => {
  const httpImage = extractArticlePageData(
    '<meta property="og:image" content="http://images.example/cover.jpg"><article><p>Paragraf berita ini lebih dari cukup untuk lolos ekstraksi artikel.</p></article>',
    "https://news.example/article",
  );
  const credentialImage = extractArticlePageData(
    '<meta property="og:image" content="https://user:pass@images.example/cover.jpg"><article><p>Paragraf berita ini lebih dari cukup untuk lolos ekstraksi artikel.</p></article>',
    "https://news.example/article",
  );

  assert.equal(httpImage.imageUrl, null);
  assert.equal(credentialImage.imageUrl, null);
});
