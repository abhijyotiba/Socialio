export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <div className="relative hidden w-[46%] overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(99,102,241,0.28),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(37,99,235,0.24),transparent_50%),linear-gradient(180deg,#0f172a_0%,#111827_100%)]" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.12]" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 backdrop-blur">
            <span className="text-lg font-extrabold tracking-tight text-white">S</span>
          </div>
          <div>
            <p className="font-display text-xl font-extrabold tracking-tight text-white">SocialOS</p>
            <p className="text-xs text-white/60">AI-first social publishing</p>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-5">
          <p className="text-sm uppercase tracking-[0.24em] text-indigo-200/70">
            Professional publishing workflow
          </p>
          <h1 className="font-display text-4xl font-black leading-tight text-white">
            Plan, generate, and publish in one polished workspace.
          </h1>
          <p className="text-sm leading-relaxed text-slate-300">
            Turn raw ideas, links, and context into platform-native content for
            LinkedIn and X with scheduling, metrics, and brand consistency built in.
          </p>
        </div>

        <div className="relative z-10 flex gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 py-1.5 text-sm text-white/85 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-[#0077b5]" />
            LinkedIn
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/8 px-4 py-1.5 text-sm text-white/85 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-white" />
            X / Twitter
          </span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-transparent px-6 py-12">
        {children}
      </div>
    </div>
  );
}
