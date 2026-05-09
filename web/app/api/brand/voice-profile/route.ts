import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import {
  getBrandConfig,
  setVoiceProfile,
  upsertBrandConfig,
} from "@/lib/db/brand-configs";
import { getDefaultPersona } from "@/lib/db/personas";
import { createPromptVersion } from "@/lib/db/prompt-versions";
import {
  WorkerError,
  workerAnalyzeVoice,
} from "@/lib/worker-client";
import type { Json } from "@/lib/db/types";

// 3–15 samples; each 20–3000 chars; total payload capped at 30 KB to keep the
// LLM token bill predictable. Tuned in PHASE_7_VOICE.md.
//
// Optional brand_details lets the onboarding flow pass brand_name / industry /
// website_url / tone_tags up front, so we can finalize brand_configs in one
// round trip without minting a duplicate prompt_versions row from a follow-up
// /api/brand/config save.
const bodySchema = z.object({
  samples: z
    .array(z.string().min(20).max(3000))
    .min(3)
    .max(15)
    .refine((arr) => arr.join("").length <= 30_000, {
      message: "Total samples exceed 30 KB",
    }),
  platform_mix: z.record(z.string(), z.number().int().nonnegative()).optional(),
  persona_id: z.string().uuid().optional(),
  brand_details: z
    .object({
      brand_name: z.string().min(1),
      industry: z.string().optional(),
      website_url: z.string().url().optional().or(z.literal("")).optional(),
      tone_tags: z.array(z.string()).optional(),
    })
    .optional(),
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

  const workspaceId = workspace.workspace_id;
  const personaId =
    parsed.data.persona_id ?? (await getDefaultPersona(workspaceId))?.id;
  if (!personaId) {
    return NextResponse.json({ error: "No persona found" }, { status: 400 });
  }

  // Brand name is required for the rendered prompt. Onboarding will pass it
  // in `brand_details`; Settings refresh will not (and we'll read the existing
  // brand_configs row).
  const existing = await getBrandConfig(workspaceId);
  const details = parsed.data.brand_details;
  const brandName =
    details?.brand_name?.trim() ||
    existing?.brand_name?.trim() ||
    "your brand";
  const toneTags = details?.tone_tags ?? existing?.tone_tags ?? [];

  let workerResp;
  try {
    workerResp = await workerAnalyzeVoice({
      workspace_id: workspaceId,
      brand_name: brandName,
      samples: parsed.data.samples,
      tone_tags: toneTags,
      platform_mix: parsed.data.platform_mix,
    });
  } catch (err) {
    if (err instanceof WorkerError) {
      // 422 → analyzer ran but couldn't validate the JSON it produced. Surface
      // the same status so the client can prompt the user to retry / edit
      // samples. 502 / 5xx from the LLM provider becomes a generic 502.
      const status = err.status === 422 ? 422 : 502;
      return NextResponse.json(
        {
          error:
            status === 422
              ? "Couldn't read the voice profile from those samples. Try with different posts."
              : "Voice analysis is temporarily unavailable. Please try again.",
        },
        { status }
      );
    }
    throw err;
  }

  const { profile, system_prompt } = workerResp;

  // 1) Persist the structured profile.
  await setVoiceProfile(workspaceId, profile as Json);

  // 2) Mint a new prompt_versions row, sourced from the voice profile.
  const promptVersion = await createPromptVersion(
    workspaceId,
    system_prompt,
    user.id,
    "voice_profile"
  );

  // 3) Update brand_configs.current_prompt_version_id + custom_system_prompt
  //    so the rest of the app (which reads custom_system_prompt) picks up
  //    the new prompt immediately. Insert a brand_configs row if the user
  //    hasn't created one yet (onboarding) — we have brand_name from details.
  await upsertBrandConfig({
    workspace_id: workspaceId,
    persona_id: personaId,
    brand_name: details?.brand_name ?? existing?.brand_name ?? brandName,
    industry:
      details?.industry !== undefined
        ? details.industry || null
        : existing?.industry ?? null,
    website_url:
      details?.website_url !== undefined
        ? details.website_url || null
        : existing?.website_url ?? null,
    tone_tags: toneTags,
    custom_system_prompt: system_prompt,
    current_prompt_version_id: promptVersion.id,
  });

  return NextResponse.json({
    profile,
    system_prompt,
    version_number: promptVersion.version_number,
  });
}
