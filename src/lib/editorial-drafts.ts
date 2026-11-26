import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { editorialDrafts, type EditorialDraft } from "@/lib/schema";

export type EditorialDraftKind = "rating_top_5" | "artis_bio" | "tebak_drama";
export type EditorialDraftStatus = "previewed" | "publishing" | "submitted" | "published" | "outcome_unknown" | "failed" | "expired";
export const EDITORIAL_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export async function saveEditorialDraft(input: {
  id?: string;
  kind: EditorialDraftKind;
  payload: Record<string, unknown>;
  expiresAt?: Date;
}): Promise<EditorialDraft> {
  const now = new Date();
  const [draft] = await getDb().insert(editorialDrafts).values({
    ...(input.id ? { id: input.id } : {}),
    kind: input.kind,
    status: "previewed",
    payload: input.payload,
    previewedAt: now,
    expiresAt: input.expiresAt ?? new Date(now.getTime() + EDITORIAL_DRAFT_TTL_MS),
    createdAt: now,
    updatedAt: now,
  }).returning();
  if (!draft) throw new Error("Pratinjau draf gagal disimpan.");
  return draft;
}

/** Atomically reserves a previewed draft so two dashboard clicks cannot publish it twice. */
export async function claimEditorialDraft(id: string, kind: EditorialDraftKind): Promise<EditorialDraft | null> {
  const now = new Date();
  const [draft] = await getDb().update(editorialDrafts).set({
    status: "publishing",
    errorMessage: null,
    updatedAt: now,
  }).where(and(
    eq(editorialDrafts.id, id),
    eq(editorialDrafts.kind, kind),
    eq(editorialDrafts.status, "previewed"),
    gt(editorialDrafts.expiresAt, now),
  )).returning();
  if (draft) return draft;

  await getDb().update(editorialDrafts).set({ status: "expired", updatedAt: now })
    .where(and(
      eq(editorialDrafts.id, id),
      eq(editorialDrafts.kind, kind),
      eq(editorialDrafts.status, "previewed"),
    ))
    .catch(() => undefined);
  return null;
}

export async function finishEditorialDraft(input: {
  id: string;
  status: Extract<EditorialDraftStatus, "submitted" | "published" | "outcome_unknown" | "failed">;
  resultId?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await getDb().update(editorialDrafts).set({
    status: input.status,
    resultId: input.resultId ?? null,
    errorMessage: input.errorMessage?.slice(0, 1_000) ?? null,
    updatedAt: new Date(),
  }).where(eq(editorialDrafts.id, input.id));
}
