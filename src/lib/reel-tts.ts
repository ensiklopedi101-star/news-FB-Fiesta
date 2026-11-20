import { Buffer } from "node:buffer";
import { OUTPUT_FORMAT } from "msedge-tts";
import { toSpeechText } from "@/lib/reel-script";

/**
 * Edge TTS is the only speech provider used for Reels: it is free, needs no API
 * key, and keeps the Gemini quota for copywriting and quiz art.
 * The voice can be swapped with REELS_TTS_VOICE (any Edge `ShortName`).
 */
export const DEFAULT_TTS_VOICE = "id-ID-GadisNeural";

export class TtsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsUnavailableError";
  }
}

export function ttsVoice(): string {
  return process.env.REELS_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
}

/** Edge TTS speaks the narration; the audio arrives as 24 kHz mono MP3. */
export async function synthesizeNarration(
  text: string,
  options: { voice?: string; timeoutMs?: number } = {},
): Promise<{ audio: Buffer; mimeType: string; characters: number }> {
  const spoken = toSpeechText(text);
  if (spoken.length < 20) throw new TtsUnavailableError("Naskah narasi terlalu pendek untuk disuarakan.");

  const voice = options.voice ?? ttsVoice();
  const timeoutMs = options.timeoutMs ?? 30_000;

  // Imported lazily so a bundling problem with the WebSocket client only breaks Reels.
  const { MsEdgeTTS } = await import("msedge-tts");
  const tts = new MsEdgeTTS({ connectionTimeoutMs: 10_000, synthesisTimeoutMs: timeoutMs });

  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(spoken);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new TtsUnavailableError("Edge TTS tidak menjawab dalam batas waktu.")), timeoutMs);
      audioStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      audioStream.on("error", (error: Error) => {
        clearTimeout(timer);
        reject(new TtsUnavailableError(`Edge TTS gagal: ${error.message}`));
      });
      audioStream.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const audio = Buffer.concat(chunks);
    if (audio.length < 2_000) throw new TtsUnavailableError("Edge TTS mengembalikan audio kosong.");
    return { audio, mimeType: "audio/mpeg", characters: spoken.length };
  } catch (error) {
    if (error instanceof TtsUnavailableError) throw error;
    throw new TtsUnavailableError(`Edge TTS gagal: ${error instanceof Error ? error.message : "tidak diketahui"}`);
  } finally {
    try {
      tts.close();
    } catch {
      // The socket is already gone; nothing to clean up.
    }
  }
}
