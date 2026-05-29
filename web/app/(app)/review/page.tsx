import { Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { listPendingApprovalVariants } from "@/lib/db/content-engine";
import { ReviewList } from "./_components/ReviewList";

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return <p className="text-sm text-slate-500">Please sign in.</p>;
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return <p className="text-sm text-slate-500">No workspace found.</p>;
  }

  const variants = await listPendingApprovalVariants(workspace.workspace_id);
  const items = variants.map((v) => ({
    id: v.id,
    platform: v.platform,
    body: v.body,
    format: v.content_items?.format ?? null,
    angle: v.content_items?.angle ?? null,
  }));

  return (
    <div className="space-y-5 page-enter">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100">
          <Inbox className="h-5 w-5" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Review Queue
          </h1>
          <p className="text-xs text-slate-400">
            Posts the engine generated, waiting for your approval before they go out.
          </p>
        </div>
      </div>

      <ReviewList initial={items} />
    </div>
  );
}
