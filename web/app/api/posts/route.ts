import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getIngestionJob, updateIngestionJob } from "@/lib/db/ingestion";
import { getBrandConfig } from "@/lib/db/brand-configs";
import {
  createContentItem,
  updateContentItem,
  createPostVariants,
} from "@/lib/db/posts";
import { workerGenerate } from "@/lib/worker-client";

const bodySchema = z.object({
  ingestion_job_id: z.string().uuid(),
  platforms: z
    .array(z.enum(["linkedin", "x"]))
    .min(1, "At least one platform required"),
});

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

  const { ingestion_job_id, platforms } = parsed.data;

  const job = await getIngestionJob(ingestion_job_id);
  if (!job) {
    return NextResponse.json(
      { error: "Ingestion job not found" },
      { status: 404 }
    );
  }
  if (job.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (job.stage !== "done") {
    return NextResponse.json(
      { error: "Ingestion job is not ready (stage must be done)" },
      { status: 409 }
    );
  }

  const brand = await getBrandConfig(workspaceId);
  if (!brand || !brand.custom_system_prompt) {
    return NextResponse.json(
      {
        error:
          "Brand config with system prompt is required before generating",
      },
      { status: 409 }
    );
  }

  try {
    const contentItem = await createContentItem({
      workspace_id: workspaceId,
      ingestion_job_id,
      prompt_version_id: brand.current_prompt_version_id ?? null,
    });

    await updateIngestionJob(ingestion_job_id, { stage: "analyzing" });

    const result = await workerGenerate({
      job_id: ingestion_job_id,
      workspace_id: workspaceId,
      extracted_title: job.extracted_title ?? "",
      extracted_text: job.extracted_text ?? "",
      brand_system_prompt: brand.custom_system_prompt,
      platforms,
    });

    await updateIngestionJob(ingestion_job_id, { stage: "storing" });

    await updateContentItem(contentItem.id, { summary: result.summary });

    const variants = await createPostVariants(
      result.variants.map((v) => ({
        workspace_id: workspaceId,
        content_item_id: contentItem.id,
        prompt_version_id: contentItem.prompt_version_id,
        platform: v.platform,
        body: v.body,
        status: "draft" as const,
      }))
    );

    await updateIngestionJob(ingestion_job_id, {
      stage: "done",
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      content_item_id: contentItem.id,
      variants: variants.map((v) => ({
        id: v.id,
        platform: v.platform,
        body: v.body,
        status: v.status,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Worker error";
    await updateIngestionJob(ingestion_job_id, {
      stage: "failed",
      error: message,
    });
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
