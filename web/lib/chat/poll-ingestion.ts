// Poll an ingestion job until it reaches a terminal stage.
//
// Replaces the previous realtime-subscription approach, which silently relied
// on Supabase realtime being enabled for ingestion_jobs (it isn't) and only
// worked for jobs that finished fast enough to be caught by a single post-
// subscribe check. Polling is the robust choice for "wait for a short job":
// it makes ~a handful of tiny requests then stops, with no realtime dependency.

export interface IngestionJob {
  stage: string;
  extracted_title?: string;
  extracted_text?: string;
  media?: Array<{ cloudinary_url: string; cloudinary_id: string }>;
  error?: string;
}

const TERMINAL_STAGES = new Set(["done", "failed"]);

export interface PollIngestionOptions {
  // Fetch the current job row. Returns null on a transient error (the poll
  // tolerates nulls and keeps trying until the timeout).
  fetchJob: () => Promise<IngestionJob | null>;
  intervalMs?: number;
  timeoutMs?: number;
  // Called with each non-terminal stage so the UI can show progress labels.
  onStage?: (stage: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollIngestion(
  _jobId: string,
  opts: PollIngestionOptions
): Promise<IngestionJob> {
  const { fetchJob, intervalMs = 1500, timeoutMs = 60000, onStage } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const job = await fetchJob();
    if (job) {
      if (TERMINAL_STAGES.has(job.stage)) {
        return job;
      }
      onStage?.(job.stage);
    }
    await sleep(intervalMs);
  }

  throw new Error("Extraction timed out.");
}
