"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Settings2, Users, Zap } from "lucide-react";

const navItems = [
  {
    href: "/settings/personas",
    label: "Personas",
    description: "Voice, connections & brand per persona",
    icon: Users,
  },
  {
    href: "/settings/autopilot",
    label: "Content Autopilot",
    description: "Cadence & reservoir",
    icon: Zap,
  },
  {
    href: "/settings/schedule",
    label: "Posting Schedule",
    description: "Recurring time slots",
    icon: CalendarClock,
  },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-start">
      {/* Sidebar nav */}
      <nav className="w-full shrink-0 lg:w-60">
        <div className="rounded-2xl panel p-2">
          <div className="mb-2 flex items-center gap-2.5 px-3 pt-2 pb-3 border-b border-border">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-accent ring-1 ring-border">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint-foreground">
                Workspace
              </p>
              <p className="text-sm font-bold text-foreground leading-tight">Settings</p>
            </div>
          </div>
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                      active
                        ? "bg-white/[0.06] text-foreground"
                        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
                        active
                          ? "bg-accent text-accent-foreground shadow-sm"
                          : "bg-surface-2 text-muted-foreground group-hover:bg-white/[0.08] group-hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold ${active ? "text-accent" : ""}`}>
                        {item.label}
                      </p>
                      <p className="truncate text-[11px] text-faint-foreground">{item.description}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {/* Page content */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
