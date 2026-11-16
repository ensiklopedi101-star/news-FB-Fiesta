import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import React from "react";
import { ImageResponse } from "next/og";
import { test } from "node:test";
import sharp from "sharp";
import { fetchOgImageDataUrl } from "../src/lib/og-image";

test("ImageResponse renders an inlined PNG asset into a complete image response", async () => {
  const bytes = await readFile(new URL("../public/brand/popbeez_icon.png", import.meta.url));
  const imageData = `data:image/png;base64,${bytes.toString("base64")}`;
  const response = new ImageResponse(
    React.createElement(
      "div",
      { style: { display: "flex", width: 1080, height: 1350 } },
      React.createElement("img", { src: imageData, width: 1080, height: 660, style: { width: "100%", height: "100%", objectFit: "cover" } }),
    ),
    { width: 1080, height: 1350 },
  );

  const output = await response.arrayBuffer();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.ok(output.byteLength > 0);
});

test("normalizes a WebP photo before passing it to next/og", async () => {
  const png = await readFile(new URL("../public/brand/popbeez_icon.png", import.meta.url));
  const webp = await sharp(png).webp().toBuffer();
  const imageData = await fetchOgImageDataUrl(
    "https://images.example/photo.webp",
    "https://publisher.example/story",
    async () => new Response(webp, { headers: { "content-type": "image/webp" } }),
  );

  assert.ok(imageData?.startsWith("data:image/jpeg;base64,"));
  const response = new ImageResponse(
    React.createElement("div", { style: { display: "flex", width: 1080, height: 660 } },
      React.createElement("img", { src: imageData, width: 1080, height: 660 })),
    { width: 1080, height: 660 },
  );

  const output = await response.arrayBuffer();
  assert.equal(response.status, 200);
  assert.ok(output.byteLength > 0);
});
