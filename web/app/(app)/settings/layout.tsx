"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Link2, Palette, Settings2 } from "lucide-react";

const navItems = [
  {
    href: "/settings/brand",
    label: "Brand",
    description: "Voice, profile, and prompt",
    icon: Palette,
  },
  {
    href: "/settings/connections",
    label: "Connections",
    description: "LinkedIn and X auth",
    icon: Link2,
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
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 lg:flex-row">
      <nav className="w-full shrink-0 lg:w-[280px]">
        <div className="rounded-3xl border border-slate-200/75 bg-white/85 p-4 shadow-[0_18px_44px_-28px_rgba(15,23,42,0.45)] backdrop-blur-sm">
          <div className="mb-3 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Workspace
              </p>
              <p className="text-sm font-bold text-slate-900">Settings</p>
            </div>
          </div>

          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Settings
          </p>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;

              return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-2xl px-3 py-3 transition ${
                    active
                      ? "bg-indigo-50 text-indigo-700 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.2)]"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl transition ${
                      active
                        ? "bg-white text-indigo-600 shadow-sm"
                        : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.label}</p>
                    <p className="truncate text-xs text-slate-400">{item.description}</p>
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        </div>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
