"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function TopBar({ email }: { email: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-50">
          SocialOS
        </span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {email}
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors"
          >
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}
