export function safeProviderError(error: unknown, secrets: string[]): string {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  let message = error instanceof Error
    ? error.message
    : typeof candidate?.message === "string" ? candidate.message : "Kesalahan tidak diketahui.";
  const status = typeof candidate?.status === "number" ? candidate.status : undefined;
  if (status && !new RegExp(`\\b${status}\\b`).test(message)) message = `HTTP ${status}: ${message}`;
  if (typeof candidate?.code === "string" && !message.includes(candidate.code)) message = `${candidate.code}: ${message}`;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/\s+/g, " ").slice(0, 500);
}
