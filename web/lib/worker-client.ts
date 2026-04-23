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
  job_id: string;
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
  });
  if (!res.ok) {
    throw new Error(`Worker /generate responded ${res.status}`);
  }
  return res.json() as Promise<WorkerGenerateResponse>;
}
