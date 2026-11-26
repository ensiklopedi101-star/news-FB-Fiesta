import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/schema";

let cached: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getDb(options?: { signal: AbortSignal }) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL belum diatur.");
  if (options) {
    // A request-scoped abort signal must never be retained in the cached client.
    const sql = neon(connectionString, { fetchOptions: { signal: options.signal, cache: "no-store" } });
    return drizzle(sql, { schema });
  }
  if (!cached) {
    const sql = neon(connectionString);
    cached = drizzle(sql, { schema });
  }
  return cached;
}
