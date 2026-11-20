#!/usr/bin/env node
/**
 * Reels render worker — runs ffmpeg where ffmpeg actually exists (a VPS), so the
 * Vercel function only has to call it over HTTPS.
 *
 *   WORKER_TOKEN=change-me node scripts/reels-render-worker.mjs
 *
 * Contract (see src/lib/reel-video.ts → renderReelRemotely):
 *   POST /render  Authorization: Bearer $WORKER_TOKEN
 *   { frames: [{ url, seconds }], audioBase64, audioMimeType, width, height }
 *   → 200 video/mp4
 *   GET  /health → { ok: true }
 *
 * ffmpeg binary: $FFMPEG_PATH, then ffmpeg on PATH.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const TOKEN = process.env.WORKER_TOKEN || "";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_BODY = 40 * 1024 * 1024;

function log(message, extra = {}) {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...extra }));
}

function buildConcatList(frames) {
  const lines = [];
  frames.forEach((frame, index) => {
    lines.push(`file 'frame-${index}.png'`);
    lines.push(`duration ${Math.max(0.6, Number(frame.seconds) || 2).toFixed(2)}`);
  });
  if (frames.length) lines.push(`file 'frame-${frames.length - 1}.png'`);
  return `${lines.join("\n")}\n`;
}

function buildArgs({ concatPath, audioPath, outputPath, width, height }) {
  return [
    "-y",
    "-f", "concat", "-safe", "0", "-i", concatPath,
    "-i", audioPath,
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-r", "30",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart",
    outputPath,
  ];
}

function run(command, args, timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => { if (stderr.length < 40) stderr.push(chunk.toString()); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-3).join(" ").slice(0, 400)}`));
    });
  });
}

async function render(payload) {
  const frames = Array.isArray(payload.frames) ? payload.frames : [];
  if (!frames.length) throw new Error("frames kosong");
  const audio = Buffer.from(String(payload.audioBase64 || ""), "base64");
  if (audio.length < 1000) throw new Error("audio kosong");

  const width = Number(payload.width) || 1080;
  const height = Number(payload.height) || 1920;
  const directory = await mkdtemp(join(tmpdir(), "reel-worker-"));

  try {
    await Promise.all(frames.map(async (frame, index) => {
      const response = await fetch(frame.url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`gambar ${index} gagal diunduh (HTTP ${response.status})`);
      await writeFile(join(directory, `frame-${index}.png`), Buffer.from(await response.arrayBuffer()));
    }));
    await writeFile(join(directory, "audio.mp3"), audio);
    const concatPath = join(directory, "slides.txt");
    await writeFile(concatPath, buildConcatList(frames), "utf8");
    const outputPath = join(directory, "reel.mp4");
    await run(FFMPEG, buildArgs({ concatPath, audioPath: join(directory, "audio.mp3"), outputPath, width, height }));
    const video = await readFile(outputPath);
    log("rendered", { frames: frames.length, bytes: video.length });
    return video;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url?.startsWith("/health")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method !== "POST" || !request.url?.startsWith("/render")) {
    response.writeHead(404).end("not found");
    return;
  }
  if (TOKEN && request.headers.authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end("unauthorized");
    return;
  }

  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      response.writeHead(413).end("payload too large");
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", async () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const video = await render(payload);
      response.writeHead(200, { "content-type": "video/mp4", "content-length": video.length });
      response.end(video);
    } catch (error) {
      log("render-failed", { error: error instanceof Error ? error.message : "unknown" });
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "unknown" }));
    }
  });
});

server.listen(PORT, HOST, () => log("listening", { host: HOST, port: PORT, ffmpeg: FFMPEG }));
