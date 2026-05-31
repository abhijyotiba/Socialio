export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="relative hidden w-[46%] overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,oklch(0.66_0.21_32/0.20),transparent_45%),radial-gradient(circle_at_80%_80%,oklch(0.66_0.21_32/0.12),transparent_50%),linear-gradient(180deg,var(--background)_0%,var(--surface)_100%)]" />
        <div className="absolute inset-0 grid-bg opacity-60" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-accent ring-1 ring-border">
            <span className="text-lg font-extrabold tracking-tight">S</span>
          </div>
          <div>
            <p className="display-lg text-xl text-foreground">SocialOS</p>
            <p className="text-xs text-muted-foreground">AI-first social publishing</p>
          </div>
        </div>

        <div className="relative z-10 max-w-md space-y-5">
          <p className="text-sm uppercase tracking-[0.24em] text-accent/80">
            Professional publishing workflow
          </p>
          <h1 className="display-xl text-4xl text-foreground">
            Plan, generate, and publish in one polished workspace.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Turn raw ideas, links, and context into platform-native content for
            LinkedIn and X with scheduling, metrics, and brand consistency built in.
          </p>
        </div>

        <div className="relative z-10 flex gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-4 py-1.5 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-[#0077b5]" />
            LinkedIn
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-4 py-1.5 text-sm text-muted-foreground">
            <span className="w-2 h-2 rounded-full bg-foreground" />
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
