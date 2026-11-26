import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REEL_HEIGHT, REEL_WIDTH } from "@/lib/reel-frames";
import type { ReelScene } from "@/lib/reel-script";

/** ffmpeg is not bundled with Vercel functions; the encoder must be provided. */
export class ReelEncoderMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReelEncoderMissingError";
  }
}

export type ReelSlide = { png: Buffer; seconds: number };

/** Concat demuxer entries; the last image repeats so the final slide holds. */
export function buildConcatList(slides: ReelSlide[]): string {
  const lines: string[] = [];
  slides.forEach((slide, index) => {
    lines.push(`file 'frame-${index}.png'`);
    lines.push(`duration ${Math.max(0.6, slide.seconds).toFixed(2)}`);
  });
  if (slides.length) lines.push(`file 'frame-${slides.length - 1}.png'`);
  return `${lines.join("\n")}\n`;
}

/** H.264 + AAC, 9:16, faststart so Facebook can start processing immediately. */
export function buildFfmpegArgs(input: { concatPath: string; audioPath: string; outputPath: string }): string[] {
  return [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", input.concatPath,
    "-i", input.audioPath,
    "-vf", `scale=${REEL_WIDTH}:${REEL_HEIGHT}:force_original_aspect_ratio=decrease,pad=${REEL_WIDTH}:${REEL_HEIGHT}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    "-r", "30",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    input.outputPath,
  ];
}

/** `FFMPEG_PATH` first, then an optionally installed ffmpeg-static, then PATH. */
export function resolveFfmpegPath(): string | null {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  // Optional dependency: absent by default so the Vercel build never downloads it.
  const bundled = resolve(process.cwd(), "node_modules/ffmpeg-static/ffmpeg");
  if (existsSync(bundled)) return bundled;
  return "ffmpeg";
}

function run(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errors: string[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ReelEncoderMissingError(`ffmpeg melebihi ${Math.round(timeoutMs / 1000)} detik.`));
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (errors.length < 40) errors.push(chunk.toString().slice(0, 400));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new ReelEncoderMissingError(`ffmpeg tidak bisa dijalankan (${error.message}). Set FFMPEG_PATH atau REELS_RENDER_URL.`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new ReelEncoderMissingError(`ffmpeg gagal (kode ${code}): ${errors.slice(-3).join(" ").slice(0, 400)}`));
    });
  });
}

/** Renders the slideshow locally; requires an ffmpeg binary on this host. */
export async function renderReelLocally(slides: ReelSlide[], audio: Buffer, timeoutMs = 150_000): Promise<Buffer> {
  const ffmpeg = resolveFfmpegPath();
  if (!ffmpeg) throw new ReelEncoderMissingError("ffmpeg tidak ditemukan. Set FFMPEG_PATH atau REELS_RENDER_URL.");
  const directory = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    await Promise.all(slides.map((slide, index) => writeFile(join(directory, `frame-${index}.png`), slide.png)));
    await writeFile(join(directory, "audio.mp3"), audio);
    const concatPath = join(directory, "slides.txt");
    await writeFile(concatPath, buildConcatList(slides), "utf8");
    const outputPath = join(directory, "reel.mp4");
    await run(ffmpeg, buildFfmpegArgs({ concatPath, audioPath: join(directory, "audio.mp3"), outputPath }), timeoutMs);
    const video = await readFile(outputPath);
    if (video.length < 20_000) throw new ReelEncoderMissingError("Hasil render terlalu kecil; encoder gagal menyusun video.");
    return video;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Renders on an external worker (for example the VPS that already runs ffmpeg).
 * See `scripts/reels-render-worker.mjs` for the contract and a ready-to-run server.
 */
export async function renderReelRemotely(input: {
  endpoint: string;
  token?: string;
  frameUrls: string[];
  scenes: ReelScene[];
  audio: Buffer;
  timeoutMs?: number;
}): Promise<Buffer> {
  const response = await fetch(`${input.endpoint.replace(/\/$/, "")}/render`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: JSON.stringify({
      frames: input.frameUrls.map((url, index) => ({ url, seconds: input.scenes[index]?.seconds ?? 2 })),
      audioBase64: input.audio.toString("base64"),
      audioMimeType: "audio/mpeg",
      width: REEL_WIDTH,
      height: REEL_HEIGHT,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 180_000),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ReelEncoderMissingError(`Worker render menjawab HTTP ${response.status}. ${detail.slice(0, 300)}`);
  }
  const video = Buffer.from(await response.arrayBuffer());
  if (video.length < 20_000) throw new ReelEncoderMissingError("Worker render mengembalikan video yang tidak valid.");
  return video;
}
