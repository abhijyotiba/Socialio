import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfig, upsertBrandConfig } from "@/lib/db/brand-configs";
import { getDefaultPersona } from "@/lib/db/personas";
import { createPromptVersion } from "@/lib/db/prompt-versions";

export async function GET() {
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

  const brandConfig = await getBrandConfig(workspace.workspace_id);
  if (!brandConfig) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(brandConfig);
}

const bodySchema = z.object({
  brand_name: z.string().min(1),
  industry: z.string().optional(),
  website_url: z.string().url().optional().or(z.literal("")).optional(),
  tone_tags: z.array(z.string()),
  system_prompt: z.string().min(1),
  persona_id: z.string().uuid().optional(),
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

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { brand_name, industry, website_url, tone_tags, system_prompt } =
    parsed.data;
  const workspaceId = workspace.workspace_id;

  const personaId =
    parsed.data.persona_id ?? (await getDefaultPersona(workspaceId))?.id;
  if (!personaId) {
    return NextResponse.json({ error: "No persona found" }, { status: 400 });
  }

  const promptVersion = await createPromptVersion(
    workspaceId,
    system_prompt,
    user.id
  );

  const brandConfig = await upsertBrandConfig({
    workspace_id: workspaceId,
    persona_id: personaId,
    brand_name,
    industry: industry ?? null,
    website_url: website_url || null,
    tone_tags,
    custom_system_prompt: system_prompt,
    current_prompt_version_id: promptVersion.id,
  });

  return NextResponse.json({
    workspace_id: workspaceId,
    current_prompt_version_id: brandConfig.current_prompt_version_id,
    version_number: promptVersion.version_number,
  });
}
