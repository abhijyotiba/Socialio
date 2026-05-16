"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarClock, Settings2, Users } from "lucide-react";

const navItems = [
  {
    href: "/settings/personas",
    label: "Personas",
    description: "Voice, connections & brand per persona",
    icon: Users,
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
        <div className="rounded-2xl border border-slate-200/70 bg-white p-2 shadow-sm">
          <div className="mb-2 flex items-center gap-2.5 px-3 pt-2 pb-3 border-b border-slate-100">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Settings2 className="h-4 w-4" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Workspace
              </p>
              <p className="text-sm font-bold text-slate-900 leading-tight">Settings</p>
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
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition ${
                        active
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-semibold ${active ? "text-indigo-700" : ""}`}>
                        {item.label}
                      </p>
                      <p className="truncate text-[11px] text-slate-400">{item.description}</p>
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
