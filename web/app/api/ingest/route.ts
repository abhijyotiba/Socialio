import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  countRecentJobs,
  createIngestionJob,
  updateIngestionJob,
} from "@/lib/db/ingestion";
import { createMediaAssets } from "@/lib/db/media-assets";
import { workerIngest } from "@/lib/worker-client";

const bodySchema = z
  .object({
    source_type: z.enum(["url", "text"]),
    source_url: z.string().url().optional(),
    source_text: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      v.source_type === "text" ? !!v.source_text : !!v.source_url,
    {
      message:
        "source_url required for type url; source_text required for type text",
    }
  );

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }
  const workspaceId = workspace.workspace_id;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { source_type, source_url, source_text } = parsed.data;

  if (source_url?.includes("linkedin.com")) {
    return NextResponse.json(
      {
        error:
          "LinkedIn URLs cannot be ingested automatically. Please paste the post text directly.",
      },
      { status: 422 }
    );
  }

  const perMinute = await countRecentJobs(workspaceId, 60);
  if (perMinute >= 2) {
    return NextResponse.json(
      { error: "Rate limit: 2 ingestions per minute." },
      { status: 429 }
    );
  }
  const perDay = await countRecentJobs(workspaceId, 86400);
  if (perDay >= 50) {
    return NextResponse.json(
      { error: "Daily ingestion limit reached (50/day)." },
      { status: 429 }
    );
  }

  const job = await createIngestionJob({
    workspace_id: workspaceId,
    source_type,
    source_url: source_url ?? null,
    source_text: source_text ?? null,
    stage: "pending",
  });

  if (source_type === "url") {
    await updateIngestionJob(job.id, { stage: "scraping" });
  }

  try {
    const result = await workerIngest({
      job_id: job.id,
      workspace_id: workspaceId,
      source_type,
      source_url,
      source_text,
    });

    await updateIngestionJob(job.id, {
      extracted_title: result.extracted_title,
      extracted_text: result.extracted_text,
      stage: "done",
      completed_at: new Date().toISOString(),
    });

    await createMediaAssets(workspaceId, job.id, result.media);

    return NextResponse.json({
      job_id: job.id,
      extracted_title: result.extracted_title,
      extracted_text: result.extracted_text,
      media: result.media,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    await updateIngestionJob(job.id, { stage: "failed", error: message });
    return NextResponse.json({ error: "Worker error" }, { status: 502 });
  }
}
