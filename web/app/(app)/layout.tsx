import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfig } from "@/lib/db/brand-configs";
import { TopBar } from "@/components/app/TopBar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";

  // Redirect first-time users to onboarding unless they're already there.
  if (!pathname.startsWith("/onboarding")) {
    const workspace = await getWorkspaceForUser(user.id);
    if (workspace) {
      const brandConfig = await getBrandConfig(workspace.workspace_id);
      if (!brandConfig) {
        redirect("/onboarding");
      }
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950">
      <TopBar email={user.email ?? ""} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
