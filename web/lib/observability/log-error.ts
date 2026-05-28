import { workerFetch } from "@/lib/worker-client";
import type { Json } from "@/lib/db/types";

// 4KB is the natural cap for a typical V8 stack trace; beyond that the
// extra frames are usually framework noise.
const MAX_STACK = 4_096;
// 1KB is generous for a message — anything longer is almost certainly a
// JSON blob accidentally thrown as an error.
const MAX_MESSAGE = 1_024;

export type ErrorContext = {
  source: "server" | "client";
  origin?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
  // Explicit override — useful when the error was constructed from an
  // HTTP payload (the /api/log-error route does this) and the synthetic
  // stack from `new Error(message)` would be misleading.
  stackOverride?: string | null;
};

/**
 * Persist an error to error_events and emit a structured log line.
 *
 * MUST NEVER THROW. If the DB write fails (e.g. Supabase outage during
 * the very outage we're trying to log) we surface the failure on stderr
 * and move on — never let the logger itself break the caller.
 */
export async function logError(
  error: unknown,
  context: ErrorContext
): Promise<void> {
  const message = String(
    (error instanceof Error && error.message) || error || "Unknown error"
  ).slice(0, MAX_MESSAGE);
  const rawStack =
    context.stackOverride ??
    (error instanceof Error && error.stack ? error.stack : null);
  const stack = rawStack ? rawStack.slice(0, MAX_STACK) : null;

  // Structured stderr line — Vercel / Fly logs surface this regardless of
  // whether the DB insert succeeds.
  console.error(
    JSON.stringify({
      level: "error",
      source: context.source,
      origin: context.origin ?? null,
      workspace_id: context.workspaceId ?? null,
      user_id: context.userId ?? null,
      message,
      metadata: context.metadata ?? {},
    })
  );

  try {
    await workerFetch("/system/log-error", {
      method: "POST",
      accessToken: "", // No JWT needed, worker verifies HMAC request signature
      json: {
        source: context.source,
        origin: context.origin ?? null,
        message,
        stack,
        metadata: {
            ...context.metadata,
            workspace_id: context.workspaceId ?? null,
            user_id: context.userId ?? null,
        }
      },
    });
  } catch (writeErr) {
    // Don't recurse — just yell at stderr.
    console.error(
      JSON.stringify({
        level: "error",
        source: "server",
        origin: "lib/observability/log-error",
        message:
          writeErr instanceof Error ? writeErr.message : "error log write failed",
      })

    );
  }
}
