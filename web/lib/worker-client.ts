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

export interface WorkerMediaItem {
  cloudinary_url: string;
  cloudinary_id: string;
  resource_type: string;
  format: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
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

export interface WorkerVariantOutput {
  platform: string;
  body: string;
}

export interface WorkerGenerateRequest {
  workspace_id: string;
  extracted_title: string;
  extracted_text: string;
  brand_system_prompt: string;
  platforms: ("linkedin" | "x")[];
  // Optional. With source: directive shaping the post.
  // Without source (extracted_text === ""): the topic itself.
  user_angle?: string | null;
}

export interface WorkerGenerateResponse {
  summary: string;
  variants: WorkerVariantOutput[];
  stage_timings: Record<string, number>;
}

export async function workerGenerate(
  req: WorkerGenerateRequest,
  signal?: AbortSignal  // [B3] optional — pass to fetch so timeout actually cancels the connection
): Promise<WorkerGenerateResponse> {
  const body = JSON.stringify(req);
  const res = await fetch(`${process.env.WORKER_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
    signal: signal ?? AbortSignal.timeout(25_000),  // caller's signal takes precedence
  });
  if (!res.ok) {
    throw new Error(`Worker /generate responded ${res.status}`);
  }
  return res.json() as Promise<WorkerGenerateResponse>;
}

// ─── Phase 7: voice analyze + regenerate ────────────────────────────────────

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

export interface WorkerRegenerateRequest {
  workspace_id: string;
  variant_id: string;
  platform: "linkedin" | "x";
  current_body: string;
  instruction: string;
  brand_system_prompt: string;
  summary?: string | null;
}

export interface WorkerRegenerateResponse {
  body: string;
  stage_timings: Record<string, number>;
}

export async function workerRegenerate(
  req: WorkerRegenerateRequest
): Promise<WorkerRegenerateResponse> {
  const body = JSON.stringify({
    ...req,
    summary: req.summary ?? null,
  });
  const res = await fetch(`${process.env.WORKER_URL}/generate/regenerate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new WorkerError(
      res.status,
      `Worker /generate/regenerate responded ${res.status}`,
      detail
    );
  }
  return res.json() as Promise<WorkerRegenerateResponse>;
}
