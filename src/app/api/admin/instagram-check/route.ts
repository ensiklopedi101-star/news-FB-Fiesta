import { NextRequest, NextResponse } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { facebookPageId, getInstagramConfigurationGaps, instagramCredentials, instagramUsername } from "@/lib/instagram-config";
import { formatGraphError, redactToken } from "@/lib/instagram-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Read-only Instagram health check: who the token belongs to, which IG business
 * account is linked to the Facebook page, and how much publishing quota is left.
 * Nothing is posted here — it only calls GET endpoints.
 *
 * GET /api/admin/instagram-check  (Authorization: Bearer <CRON_SECRET>)
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gaps = getInstagramConfigurationGaps();
  const credentials = instagramCredentials();
  const pageId = facebookPageId();
  const version = process.env.FB_GRAPH_VERSION?.trim() || "v23.0";
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  push("Kredensial Instagram", gaps.length === 0, gaps.length === 0 ? "IG_USER_ID dan token tersedia." : `Belum ada: ${gaps.join(", ")}`);
  if (!credentials) {
    return NextResponse.json(
      { ok: false, username: instagramUsername(), checks, next: "Isi IG_USER_ID dan IG_ACCESS_TOKEN di Vercel, lalu deploy ulang." },
      { status: 200 },
    );
  }

  const { userId, token } = credentials;
  const get = async (path: string, fields: string) => {
    const response = await fetch(
      `https://graph.facebook.com/${version}/${path}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(15_000), cache: "no-store" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw formatGraphError(response.status, data, token);
    return data as Record<string, unknown>;
  };
  const safe = async <T,>(run: () => Promise<T>): Promise<{ value?: T; error?: string }> => {
    try {
      return { value: await run() };
    } catch (error) {
      return { error: redactToken(error instanceof Error ? error.message : String(error), token) };
    }
  };

  const account = await safe(() => get(encodeURIComponent(userId), "id,username,followers_count,media_count"));
  push(
    "Akun Instagram",
    Boolean(account.value),
    account.value
      ? `@${String(account.value.username ?? "-")} · ${String(account.value.media_count ?? "?")} media · ${String(account.value.followers_count ?? "?")} follower.`
      : account.error ?? "Tidak bisa membaca akun.",
  );

  if (pageId) {
    const linked = await safe(() => get(encodeURIComponent(pageId), "id,name,instagram_business_account{id,username}"));
    const linkedAccount = linked.value?.instagram_business_account as { id?: string; username?: string } | undefined;
    push(
      "Tautan halaman ↔ Instagram",
      Boolean(linkedAccount?.id) && linkedAccount?.id === userId,
      linkedAccount?.id
        ? linkedAccount.id === userId
          ? `Halaman ${String(linked.value?.name ?? pageId)} tertaut ke IG ${linkedAccount.id}.`
          : `Halaman tertaut ke IG ${linkedAccount.id}, tetapi IG_USER_ID berisi ${userId}. Samakan salah satunya.`
        : linked.error ?? "Halaman ini belum punya akun Instagram Business yang tertaut.",
    );
  } else {
    push("Tautan halaman ↔ Instagram", false, "FB_ENTERTAINMENT_PAGE_ID / FB_PAGE_ID belum diisi, jadi tautan tidak bisa diverifikasi.");
  }

  const quota = await safe(() => get(`${encodeURIComponent(userId)}/content_publishing_limit`, "quota_usage,config"));
  const quotaRow = (quota.value?.data as Array<{ quota_usage?: number; config?: { quota_total?: number } }> | undefined)?.[0];
  push(
    "Izin publish (instagram_content_publish)",
    Boolean(quota.value),
    quota.value
      ? `Kuota publish terpakai ${quotaRow?.quota_usage ?? 0}/${quotaRow?.config?.quota_total ?? 50} per 24 jam.`
      : quota.error ?? "Tidak bisa membaca kuota publish.",
  );

  const ok = checks.every((check) => check.ok);
  return NextResponse.json({
    ok,
    username: instagramUsername(),
    userId,
    version,
    checks,
    next: ok
      ? "Semua pemeriksaan lolos. Pipeline akan mencerminkan post Facebook ke Instagram."
      : "Perbaiki pemeriksaan yang gagal di atas, lalu jalankan ulang endpoint ini.",
  });
}
