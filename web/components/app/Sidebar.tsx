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
  Inbox,
} from "lucide-react";

const nav = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Chat", href: "/chat", icon: PenLine },
  { name: "Campaigns", href: "/campaigns", icon: Inbox },
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
      <div className="relative m-3 mr-0 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-[24px] border border-border bg-sidebar p-5 text-foreground shadow-[0_28px_80px_-24px_rgba(0,0,0,0.8)]">
        <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-full bg-[oklch(0.66_0.21_32/0.14)] blur-[96px]" />

        {/* Logo */}
        <div className="relative z-10 mb-8 mt-1 px-3 py-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-surface-2 text-accent ring-1 ring-border">
              <Zap size={20} fill="currentColor" />
            </div>
            <div>
              <p className="display-lg text-xl text-foreground">SocialOS</p>
              <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-accent/80">
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
                className={`group relative flex items-center gap-3.5 overflow-hidden rounded-xl px-4 py-3 text-sm font-bold tracking-wide transition-all duration-200 ${
                  active
                    ? "translate-x-0.5 bg-white/[0.06] text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                }`}
              >
                {active && (
                  <span className="absolute bottom-[20%] left-0 top-[20%] w-1 rounded-full bg-accent" />
                )}
                <Icon
                  className={`h-[18px] w-[18px] flex-shrink-0 transition-all duration-200 group-hover:scale-110 ${
                    active
                      ? "text-accent drop-shadow-[0_0_8px_oklch(0.66_0.21_32/0.7)]"
                      : "text-muted-foreground group-hover:text-foreground"
                  }`}
                />
                {name}
              </Link>
            );
          })}
        </nav>

        {/* Bottom: profile card + sign out */}
        <div className="relative z-10 mt-auto space-y-2 border-t border-border pt-5">
          {/* Profile card — clickable */}
          <Link
            href="/profile"
            className={`flex items-center gap-3 rounded-xl border p-3.5 transition-all ${
              isProfileActive
                ? "border-accent/40 bg-white/[0.06]"
                : "border-border bg-white/[0.03] hover:border-border-strong hover:bg-white/[0.06]"
            }`}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-2 text-xs font-bold text-accent ring-1 ring-border">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold capitalize tracking-tight text-foreground">{displayName}</p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-faint-foreground">
                View profile
              </p>
            </div>
            <User className="h-4 w-4 shrink-0 text-faint-foreground" />
          </Link>

          {/* Sign out */}
          <button
            onClick={handleLogout}
            className="group flex h-12 w-full items-center gap-3.5 rounded-xl px-3 text-muted-foreground transition-all hover:bg-white/[0.04] hover:text-foreground"
            title="Sign out"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05] transition-all group-hover:bg-red-500/20 group-hover:text-red-400">
              <LogOut className="h-4 w-4" />
            </span>
            <span className="text-sm font-bold tracking-wide">Sign Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
