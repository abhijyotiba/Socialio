import { createHmac } from "crypto";

function signBody(body: string): string {
  return (
    "sha256=" +
    createHmac("sha256", process.env.WORKER_SHARED_SECRET!)
      .update(body)
      .digest("hex")
  );
}

// Generic signed + JWT-authenticated proxy to the worker. `json === undefined`
// means no body (GET/DELETE); the signature is then computed over "" to match
// the worker's HMAC check on an empty body.
export async function workerFetch(
  path: string,
  opts: { method: string; accessToken: string; json?: unknown; timeoutMs?: number }
): Promise<Response> {
  const hasBody = opts.json !== undefined;
  const body = hasBody ? JSON.stringify(opts.json) : "";
  const headers: Record<string, string> = {
    "X-Worker-Signature": signBody(body),
    Authorization: `Bearer ${opts.accessToken}`,
  };
  if (hasBody) headers["Content-Type"] = "application/json";
  return fetch(`${process.env.WORKER_URL}${path}`, {
    method: opts.method,
    headers,
    body: hasBody ? body : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
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

// Voice analysis (`/brand/voice-profile`) now runs in-process in the worker,
// so the dedicated HTTP voice client was removed.
