import { createHmac } from "crypto";

function signBody(body: string): string {
  return (
    "sha256=" +
    createHmac("sha256", process.env.WORKER_SHARED_SECRET!)
      .update(body)
      .digest("hex")
  );
}

export interface WorkerIngestRequest {
  source_type: "url" | "text";
  source_url?: string;
  source_text?: string;
}

// The worker now owns ingestion (job creation, scraping, DB writes), scoped to
// the calling user via their forwarded Supabase JWT + RLS. The web route is a
// thin proxy, so these return the raw Response for status/body passthrough.
export async function workerIngest(
  req: WorkerIngestRequest,
  accessToken: string
): Promise<Response> {
  const body = JSON.stringify(req);
  return fetch(`${process.env.WORKER_URL}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
      Authorization: `Bearer ${accessToken}`,
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
}

export async function workerGetIngestion(
  jobId: string,
  accessToken: string
): Promise<Response> {
  return fetch(
    `${process.env.WORKER_URL}/ingest/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      headers: {
        "X-Worker-Signature": signBody(""),
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    }
  );
}

// Campaign generation now runs entirely in the worker (orchestration + the LLM
// pipeline + content_items/post_variants writes), scoped to the user's JWT + RLS.
// The web route is a thin proxy; this returns the raw Response for passthrough.
// Generous timeout: the worker generates for every persona in one request.
export async function workerCampaigns(
  payload: unknown,
  accessToken: string
): Promise<Response> {
  const body = JSON.stringify(payload);
  return fetch(`${process.env.WORKER_URL}/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
      Authorization: `Bearer ${accessToken}`,
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
}

// Regeneration (brand load, revision snapshots, LLM call, persist) runs in the
// worker. Thin proxy returning the raw Response for passthrough.
export async function workerRegeneratePost(
  variantId: string,
  payload: unknown,
  accessToken: string
): Promise<Response> {
  const body = JSON.stringify(payload);
  return fetch(
    `${process.env.WORKER_URL}/posts/${encodeURIComponent(variantId)}/regenerate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Signature": signBody(body),
        Authorization: `Bearer ${accessToken}`,
      },
      body,
      signal: AbortSignal.timeout(25_000),
    }
  );
}

// ─── Phase 7: voice analyze (still HMAC-only, not yet migrated) ──────────────

export interface WorkerVoiceAnalyzeRequest {
  workspace_id: string;
  brand_name: string;
  samples: string[];
  tone_tags?: string[];
  platform_mix?: Record<string, number>;
}

export interface WorkerVoiceAnalyzeResponse {
  /** Opaque structured profile; the worker is the schema-of-record. */
  profile: Record<string, unknown>;
  system_prompt: string;
  stage_timings: Record<string, number>;
}

export class WorkerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly detail?: string
  ) {
    super(message);
  }
}

export async function workerAnalyzeVoice(
  req: WorkerVoiceAnalyzeRequest
): Promise<WorkerVoiceAnalyzeResponse> {
  const body = JSON.stringify(req);
  const res = await fetch(`${process.env.WORKER_URL}/voice/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new WorkerError(
      res.status,
      `Worker /voice/analyze responded ${res.status}`,
      detail
    );
  }
  return res.json() as Promise<WorkerVoiceAnalyzeResponse>;
}
