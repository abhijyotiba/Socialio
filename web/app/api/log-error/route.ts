import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { logError } from "@/lib/observability/log-error";

// Client-side error reports — Next.js error boundaries POST here.
// Anyone can call it (errors can happen pre-auth), so we cap message and
// stack sizes server-side to prevent the table from getting weaponised.
const bodySchema = z.object({
  message: z.string().min(1).max(1_024),
  stack: z.string().max(8_192).optional(),
  origin: z.string().max(256).optional(),
  digest: z.string().max(128).optional(),
});

export async function POST(request: Request) {
  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Best-effort attach who the report came from. Anonymous reports are
  // still useful — pre-login errors are common.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const workspace = user ? await getWorkspaceForUser(user.id) : null;

  await logError(new Error(parsed.data.message), {
    source: "client",
    origin: parsed.data.origin ?? null,
    userId: user?.id ?? null,
    workspaceId: workspace?.workspace_id ?? null,
    stackOverride: parsed.data.stack ?? null,
    metadata: { digest: parsed.data.digest ?? null },
  });

  return NextResponse.json({ ok: true });
}
