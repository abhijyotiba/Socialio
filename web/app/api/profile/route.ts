import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getDefaultPersona } from "@/lib/db/personas";
import { getBrandConfigForPersona } from "@/lib/db/brand-configs";
import { getSocialConnectionForPersona } from "@/lib/db/social-connections";
import { countVariantsByStatus } from "@/lib/db/posts";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getWorkspaceForUser(user.id);
  const defaultPersona = workspace
    ? await getDefaultPersona(workspace.workspace_id)
    : null;
  const [brandConfig, linkedin, xConn] = defaultPersona
    ? await Promise.all([
        getBrandConfigForPersona(defaultPersona.id),
        getSocialConnectionForPersona(defaultPersona.id, "linkedin"),
        getSocialConnectionForPersona(defaultPersona.id, "x"),
      ])
    : [null, null, null];

  // Post counts — parallel; collapse to zeros when there's no workspace yet.
  const [scheduledCount, publishedCount, draftCount] = workspace
    ? await Promise.all([
        countVariantsByStatus(workspace.workspace_id, "scheduled"),
        countVariantsByStatus(workspace.workspace_id, "published"),
        countVariantsByStatus(workspace.workspace_id, "draft"),
      ])
    : [0, 0, 0];

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    workspace: workspace
      ? {
          id: workspace.workspace_id,
          name: (workspace.workspaces as { name?: string } | null)?.name ?? null,
          role: workspace.role,
          created_at: (workspace.workspaces as { created_at?: string } | null)?.created_at ?? null,
        }
      : null,
    brand: brandConfig
      ? {
          brand_name: brandConfig.brand_name,
          industry: brandConfig.industry,
          website_url: brandConfig.website_url,
          tone_tags: brandConfig.tone_tags,
        }
      : null,
    connections: {
      linkedin: linkedin
        ? { connected: !linkedin.needs_reauth, username: linkedin.platform_username, expires_at: linkedin.token_expires_at }
        : null,
      x: xConn
        ? { connected: !xConn.needs_reauth, username: xConn.platform_username, expires_at: xConn.token_expires_at }
        : null,
    },
    stats: {
      published: publishedCount,
      scheduled: scheduledCount,
      drafts: draftCount,
    },
  });
}

const patchSchema = z.object({
  display_name: z.string().min(1).max(80),
});

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { error } = await supabase.auth.updateUser({
    data: { display_name: parsed.data.display_name },
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ saved: true });
}
