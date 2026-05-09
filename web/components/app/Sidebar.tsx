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
  User,
} from "lucide-react";

const nav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Chat", href: "/chat", icon: PenLine },
  { name: "Queue", href: "/queue", icon: CalendarClock },
  { name: "Settings", href: "/settings/personas", icon: SlidersHorizontal },
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
  const isProfileActive = pathname === "/profile";

  return (
    <aside className="z-10 w-[280px] flex-shrink-0">
      <div className="relative m-3 mr-0 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(165deg,#141727_0%,#19132f_54%,#101a2b_100%)] p-5 text-white shadow-[0_28px_80px_-24px_rgba(2,6,23,0.7)]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-indigo-500/20 blur-[96px]" />

        {/* Logo */}
        <div className="relative z-10 mb-8 mt-1 px-3 py-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-[16px] bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/30">
              <Zap size={20} fill="currentColor" />
            </div>
            <div>
              <p className="font-display text-xl font-bold leading-tight tracking-tight text-white">SocialOS</p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-indigo-300/85">
                Content Engine
              </p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="relative z-10 flex-1 space-y-1.5">
          {nav.map(({ name, href, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/chat" && pathname.startsWith(href + "/")) ||
              (href === "/settings/personas" && pathname.startsWith("/settings"));
            return (
              <Link
                key={href}
                href={href}
                className={`group relative flex items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-3 text-sm font-bold tracking-wide transition-all duration-200 ${
                  active
                    ? "translate-x-0.5 bg-white/10 text-white shadow-lg shadow-black/20"
                    : "text-gray-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                {active && (
                  <span className="absolute bottom-[20%] left-0 top-[20%] w-1 rounded-full bg-indigo-500" />
                )}
                <Icon
                  className={`h-[18px] w-[18px] flex-shrink-0 transition-all duration-200 group-hover:scale-110 ${
                    active
                      ? "text-indigo-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.7)]"
                      : "text-gray-400 group-hover:text-gray-200"
                  }`}
                />
                {name}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: profile card + sign out */}
        <div className="relative z-10 mt-auto space-y-2 border-t border-white/10 pt-5">
          {/* Profile card — clickable */}
          <Link
            href="/profile"
            className={`flex items-center gap-3 rounded-2xl border p-3.5 backdrop-blur-md transition-all ${
              isProfileActive
                ? "border-indigo-500/40 bg-white/10"
                : "border-white/5 bg-white/5 hover:border-white/10 hover:bg-white/8"
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold text-white shadow-md shadow-indigo-500/30">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold capitalize tracking-tight text-white">{displayName}</p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                View profile
              </p>
            </div>
            <User className="h-4 w-4 shrink-0 text-gray-500" />
          </Link>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="group flex h-12 w-full items-center gap-3.5 rounded-2xl px-3 text-gray-400 transition-all hover:bg-white/5 hover:text-white"
            title="Sign out"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 transition-all group-hover:bg-red-500/20 group-hover:text-red-400">
              <LogOut className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold tracking-wide">Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
