import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getBrandConfig } from "@/lib/db/brand-configs";
import { Sidebar } from "@/components/app/Sidebar";

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
    <div className="relative flex min-h-screen overflow-hidden bg-transparent">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_700px_at_20%_-10%,rgba(124,58,237,0.08),transparent),radial-gradient(900px_600px_at_100%_110%,rgba(37,99,235,0.08),transparent)]" />
      <Sidebar email={user.email ?? ""} />
      <main className="relative z-10 flex-1 overflow-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
