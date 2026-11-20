import assert from "node:assert/strict";
import test from "node:test";

import { buildConcatList, buildFfmpegArgs } from "@/lib/reel-video";

const slides = [
  { png: Buffer.from("a"), seconds: 3.2 },
  { png: Buffer.from("b"), seconds: 2 },
];

test("concat list memakai durasi dan mengulang frame terakhir", () => {
  const list = buildConcatList(slides);
  const lines = list.trim().split("\n");
  assert.equal(lines[0], "file 'frame-0.png'");
  assert.equal(lines[1], "duration 3.20");
  assert.equal(lines[2], "file 'frame-1.png'");
  assert.equal(lines[3], "duration 2.00");
  assert.equal(lines[4], "file 'frame-1.png'");
});

test("durasi sangat pendek dinaikkan agar frame terbaca", () => {
  const list = buildConcatList([{ png: Buffer.from("a"), seconds: 0.1 }]);
  assert.match(list, /duration 0\.60/);
});

test("argumen ffmpeg menghasilkan mp4 vertikal h264 + aac", () => {
  const args = buildFfmpegArgs({ concatPath: "/tmp/slides.txt", audioPath: "/tmp/audio.mp3", outputPath: "/tmp/reel.mp4" });
  const joined = args.join(" ");
  assert.match(joined, /-c:v libx264/);
  assert.match(joined, /-c:a aac/);
  assert.match(joined, /scale=1080:1920/);
  assert.match(joined, /-shortest/);
  assert.match(joined, /\+faststart/);
  assert.equal(args.at(-1), "/tmp/reel.mp4");
});
