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
  job_id: string;
  workspace_id: string;
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

export interface WorkerIngestResponse {
  extracted_title: string;
  extracted_text: string;
  media: WorkerMediaItem[];
  stage_timings: Record<string, number>;
}

export async function workerIngest(
  req: WorkerIngestRequest
): Promise<WorkerIngestResponse> {
  const body = JSON.stringify(req);
  const res = await fetch(`${process.env.WORKER_URL}/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new Error(`Worker /ingest responded ${res.status}`);
  }
  return res.json() as Promise<WorkerIngestResponse>;
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
}

export interface WorkerGenerateResponse {
  summary: string;
  variants: WorkerVariantOutput[];
  stage_timings: Record<string, number>;
}

export async function workerGenerate(
  req: WorkerGenerateRequest
): Promise<WorkerGenerateResponse> {
  const body = JSON.stringify(req);
  const res = await fetch(`${process.env.WORKER_URL}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Worker-Signature": signBody(body),
    },
    body,
    signal: AbortSignal.timeout(25_000),
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
