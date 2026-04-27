import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfig } from "@/lib/db/brand-configs";
import { getSocialConnection } from "@/lib/db/social-connections";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await getWorkspaceForUser(user.id);
  const [brandConfig, linkedin, xConn] = workspace
    ? await Promise.all([
        getBrandConfig(workspace.workspace_id),
        getSocialConnection(workspace.workspace_id, "linkedin"),
        getSocialConnection(workspace.workspace_id, "x"),
      ])
    : [null, null, null];

  // Post counts
  const { count: scheduledCount } = await supabase
    .from("post_variants")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace?.workspace_id ?? "")
    .eq("status", "scheduled");

  const { count: publishedCount } = await supabase
    .from("post_variants")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace?.workspace_id ?? "")
    .eq("status", "published");

  const { count: draftCount } = await supabase
    .from("post_variants")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace?.workspace_id ?? "")
    .eq("status", "draft");

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
      published: publishedCount ?? 0,
      scheduled: scheduledCount ?? 0,
      drafts: draftCount ?? 0,
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
