import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type IngestionJobRow = Database["public"]["Tables"]["ingestion_jobs"]["Row"];

// Job creation, updates, scraping, and rate-limiting moved to the Python worker
// (worker/routes/ingest.py + worker/db/ingestion.py). This read is still used by
// the campaigns route to load a job's extracted content.
export async function getIngestionJob(
  id: string
): Promise<IngestionJobRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingestion_jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}
