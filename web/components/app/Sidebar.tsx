"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  PenLine,
  LayoutDashboard,
  CalendarClock,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";

const nav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Chat", href: "/chat", icon: PenLine },
  { name: "Queue", href: "/queue", icon: CalendarClock },
  { name: "Settings", href: "/settings/brand", icon: SlidersHorizontal },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = email.slice(0, 2).toUpperCase();

  return (
    <aside className="z-10 w-72 flex-shrink-0">
      <div className="m-3 mr-0 flex h-[calc(100vh-1.5rem)] flex-col rounded-3xl border border-white/10 bg-[linear-gradient(160deg,#17142e_0%,#111827_55%,#0f172a_100%)] p-4 text-white shadow-[0_24px_80px_-24px_rgba(15,23,42,0.65)]">
        <div className="mb-6 px-2 pt-2">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-400 to-violet-500 shadow-lg shadow-indigo-900/40">
              <span className="text-sm font-extrabold tracking-tight">S</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-white/80">SocialOS</p>
              <p className="text-xs text-white/50">Publishing workspace</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1.5">
          {nav.map(({ name, href, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/chat" && pathname.startsWith(href + "/")) ||
              (href === "/settings/brand" && pathname.startsWith("/settings"));
            return (
              <Link
                key={href}
                href={href}
                className={`group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-white/12 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                    : "text-white/65 hover:bg-white/8 hover:text-white"
                }`}
              >
                <Icon
                  className={`h-4 w-4 flex-shrink-0 transition ${
                    active ? "text-indigo-300" : "text-white/55 group-hover:text-white/85"
                  }`}
                />
                {name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 rounded-2xl border border-white/12 bg-white/6 p-3 backdrop-blur-sm">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-violet-500">
              <span className="text-[10px] font-bold text-white">{initials}</span>
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-medium text-white/80">
              {email}
            </p>
            <button
              onClick={handleLogout}
              className="rounded-md p-1 text-white/55 transition hover:bg-white/10 hover:text-white"
              title="Log out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
