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
  Zap,
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
  const displayName = email.split("@")[0]?.replace(/[._-]/g, " ") || "Workspace user";

  return (
    <aside className="z-10 w-[300px] flex-shrink-0">
      <div className="relative m-3 mr-0 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(165deg,#141727_0%,#19132f_54%,#101a2b_100%)] p-5 text-white shadow-[0_28px_80px_-24px_rgba(2,6,23,0.7)]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-500/20 blur-[96px]" />

        <div className="relative z-10 mb-8 mt-1 px-3 py-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-xl shadow-indigo-500/30">
              <Zap size={24} fill="currentColor" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-[1.05] tracking-tight text-white">SocialOS</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-indigo-300/85">
                Content Engine
              </p>
            </div>
          </div>
        </div>

        <nav className="relative z-10 flex-1 space-y-2">
          {nav.map(({ name, href, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/chat" && pathname.startsWith(href + "/")) ||
              (href === "/settings/brand" && pathname.startsWith("/settings"));
            return (
              <Link
                key={href}
                href={href}
                className={`group relative flex items-center gap-4 overflow-hidden rounded-2xl px-5 py-4 text-sm font-bold tracking-wide transition-all duration-300 ${
                  active
                    ? "translate-x-1 bg-white/10 text-white shadow-xl shadow-black/20"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {active ? (
                  <span className="absolute bottom-[20%] left-0 top-[20%] w-1 rounded-full bg-indigo-500" />
                ) : null}
                <Icon
                  className={`h-5 w-5 flex-shrink-0 transition-all duration-300 group-hover:scale-110 ${
                    active
                      ? "text-indigo-300 drop-shadow-[0_0_10px_rgba(129,140,248,0.6)]"
                      : "text-gray-400 group-hover:text-gray-200"
                  }`}
                />
                {name}
              </Link>
            );
          })}
        </nav>

        <div className="relative z-10 mt-auto border-t border-white/10 pt-8">
          <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/5 bg-white/5 p-4 backdrop-blur-md">
            <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border-2 border-indigo-500/30 bg-indigo-600 text-xs font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight text-white">{displayName}</p>
              <p className="truncate text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Enterprise Plan
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="group flex h-14 w-full items-center gap-4 rounded-2xl px-3 text-gray-400 transition-all hover:bg-white/5 hover:text-white"
            title="Sign out"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5 transition-all group-hover:bg-red-500/20 group-hover:text-red-400">
              <LogOut className="h-5 w-5" />
            </span>
            <span className="text-sm font-bold tracking-wide">Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
