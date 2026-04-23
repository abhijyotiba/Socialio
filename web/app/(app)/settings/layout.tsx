import Link from "next/link";

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
  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 flex gap-8">
      <nav className="w-48 shrink-0">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-3">
          Settings
        </p>
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block text-sm px-3 py-2 rounded-md text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-50 transition-colors"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
