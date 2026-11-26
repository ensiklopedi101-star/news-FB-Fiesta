import { z } from "zod";
import { posterTitleKey } from "./quiz";

export const QUIZ_DIFFICULTIES = { easy: "Mudah · blur ringan", medium: "Sedang · mosaik warna", hard: "Sulit · mosaik hitam-putih" } as const;
export type QuizDifficulty = keyof typeof QUIZ_DIFFICULTIES;
export const quizEditsSchema = z.object({
  editionId: z.string().uuid(),
  previewUrl: z.string().url(),
  tiles: z.array(z.object({ imageUrl: z.string().url(), difficulty: z.enum(["easy", "medium", "hard"]) })).length(5),
});
export type QuizSource = { title: string; imageUrl: string; reviewId: string };
export function validateQuizSelection(
  tiles: Array<{ imageUrl: string }>, candidates: QuizSource[],
): QuizSource[] {
  const selected = tiles.map(tile => {
    const source = candidates.find(candidate => candidate.imageUrl === tile.imageUrl);
    if (!source) throw new Error("Poster tidak tersedia atau kuota pemakaiannya habis. Muat ulang pilihan.");
    return source;
  });
  if (selected.length !== 5 || new Set(selected.map(s => s.imageUrl)).size !== 5 || new Set(selected.map(s => posterTitleKey(s.title))).size !== 5) {
    throw new Error("Pilih lima poster dari judul yang berbeda.");
  }
  return selected;
}
export function quizDifficulties(values: unknown): QuizDifficulty[] {
  const parsed = z.array(z.enum(["easy", "medium", "hard"])).length(5).safeParse(values);
  return parsed.success ? parsed.data : Array.from({ length: 5 }, () => "medium");
}

/** URLs are immutable render revisions: stale approvals/edits must fail closed. */
export function isCurrentQuizDraft(row: { status: string; imageUrl: string | null }, previewUrl: string): boolean {
  return row.status === "draft" && !!row.imageUrl && row.imageUrl === previewUrl;
}
