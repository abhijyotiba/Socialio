import { createHmac } from "crypto";

function signBody(body: string | Buffer): string {
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

// Campaign generation now runs entirely in the worker under the user's JWT +
// RLS. The route does only lightweight validation + row creation, then kicks
// off the LLM pipeline in a background task and returns { campaign_id, status:
// "generating" } immediately — so a short timeout is enough. The web route is a
// thin proxy; this returns the raw Response for passthrough.
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
    signal: AbortSignal.timeout(20_000),
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

// ── Post mutations (all now owned by the worker) ──────────────────────────────

// Schedule a post variant (status → 'scheduled', sets scheduled_at).
export async function workerSchedulePost(
  variantId: string,
  scheduledAt: string,
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}/schedule`, {
    method: "POST",
    accessToken,
    json: { scheduled_at: scheduledAt },
  });
}

// Cancel a scheduled post variant (status → 'cancelled').
export async function workerCancelPost(
  variantId: string,
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}/cancel`, {
    method: "POST",
    accessToken,
  });
}

// Edit a post variant's body text.
export async function workerPatchPost(
  variantId: string,
  body: string,
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}`, {
    method: "PATCH",
    accessToken,
    json: { body },
  });
}

// Update (replace) the ordered media attachments for a post variant.
export async function workerUpdatePostMedia(
  variantId: string,
  mediaAssetIds: string[],
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}/media`, {
    method: "PUT",
    accessToken,
    json: { media_asset_ids: mediaAssetIds },
  });
}

// Revert a post variant to a historical revision number.
export async function workerRevertPost(
  variantId: string,
  revisionNumber: number,
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}/revert`, {
    method: "POST",
    accessToken,
    json: { revision_number: revisionNumber },
  });
}

// ── Posting schedule slots (mutations owned by the worker) ───────────────────

// Create a new posting schedule slot.
export async function workerCreateScheduleSlot(
  payload: unknown,
  accessToken: string
): Promise<Response> {
  return workerFetch("/schedule-slots", {
    method: "POST",
    accessToken,
    json: payload,
  });
}

// Delete a posting schedule slot.
export async function workerDeleteScheduleSlot(
  slotId: string,
  accessToken: string
): Promise<Response> {
  return workerFetch(`/schedule-slots/${encodeURIComponent(slotId)}`, {
    method: "DELETE",
    accessToken,
  });
}

// Upload raw media buffer to the worker.
export async function workerUploadMedia(
  fileBuffer: Buffer,
  mimeType: string,
  accessToken: string
): Promise<Response> {
  return fetch(`${process.env.WORKER_URL}/media/upload`, {
    method: "POST",
    headers: {
      "X-Worker-Signature": signBody(fileBuffer),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
    },
    body: new Uint8Array(fileBuffer),
    signal: AbortSignal.timeout(60_000),
  });
}

export async function workerLinkedinCallback(
  code: string,
  personaId: string,
  accessToken: string
): Promise<Response> {
  return workerFetch("/oauth/linkedin/callback", {
    method: "POST",
    accessToken,
    json: { code, persona_id: personaId },
  });
}

export async function workerXCallback(
  code: string,
  personaId: string,
  codeVerifier: string,
  accessToken: string
): Promise<Response> {
  return workerFetch("/oauth/x/callback", {
    method: "POST",
    accessToken,
    json: { code, persona_id: personaId, code_verifier: codeVerifier },
  });
}

// ── Content engine (atomization matrix + cadence) ─────────────────────────────

// Atomize an ingested asset into the matrix (extract ideas + materialize cells).
// The worker owns the LLM extraction and the content_ideas/content_items writes.
// Generous timeout: one LLM extraction call plus a bulk materialize.
export async function workerAtomize(
  payload: { ingestion_job_id: string; persona_id: string; platforms: string[] },
  accessToken: string
): Promise<Response> {
  return workerFetch("/content-engine/atomize", {
    method: "POST",
    accessToken,
    json: payload,
    timeoutMs: 60_000,
  });
}

// Upsert the "set it once" cadence config for a persona+platform.
export async function workerUpsertCadence(
  payload: unknown,
  accessToken: string
): Promise<Response> {
  return workerFetch("/content-engine/cadence", {
    method: "PUT",
    accessToken,
    json: payload,
  });
}

// Batch-review action on a pending_approval post variant: approve → draft,
// reject → cancelled.
export async function workerReviewPost(
  variantId: string,
  action: "approve" | "reject",
  accessToken: string
): Promise<Response> {
  return workerFetch(`/posts/${encodeURIComponent(variantId)}/review`, {
    method: "POST",
    accessToken,
    json: { action },
  });
}


