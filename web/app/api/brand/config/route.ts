import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfigForPersona, upsertBrandConfig } from "@/lib/db/brand-configs";
import { getDefaultPersona } from "@/lib/db/personas";
import {
  assertPersonaInWorkspace,
  PersonaGuardError,
} from "@/lib/auth/persona-guard";
import { createPromptVersion } from "@/lib/db/prompt-versions";

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url);
  const requestedPersonaId = searchParams.get("persona_id");

  // When a persona_id is supplied, validate ownership and use it; otherwise
  // fall back to the workspace's default persona for backward compat.
  let personaId: string | null = null;
  if (requestedPersonaId) {
    try {
      await assertPersonaInWorkspace(requestedPersonaId, workspace.workspace_id);
    } catch (err) {
      if (err instanceof PersonaGuardError) {
        return NextResponse.json({ error: "Persona not found" }, { status: 404 });
      }
      throw err;
    }
    personaId = requestedPersonaId;
  } else {
    const defaultPersona = await getDefaultPersona(workspace.workspace_id);
    personaId = defaultPersona?.id ?? null;
  }

  const brandConfig = personaId
    ? await getBrandConfigForPersona(personaId)
    : null;
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
