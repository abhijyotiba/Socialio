"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/settings/brand", label: "Brand" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/schedule", label: "Posting Schedule" },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 lg:flex-row">
      <nav className="w-full shrink-0 lg:w-64">
        <div className="rounded-3xl border border-slate-200/70 bg-white/90 p-4 shadow-sm backdrop-blur">
          <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
            Settings
          </p>
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    pathname === item.href
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
