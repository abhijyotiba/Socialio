# Phase 0 — Foundation

The goal of Phase 0 is to end the day with a deployed, authenticated "hello, {email}" page and a clean repo skeleton. Nothing more. **Resist the urge to build features here.** Every feature lives in a later phase.

If by the end of this phase you can sign up, log in, land on `/dashboard`, see your email, and log out — *in production, on the real Vercel URL* — Phase 0 is done.

---

## Prerequisites — before starting the session

Do these by hand, not via Claude. They involve web signups and dashboards.

- [ ] Create a new GitHub repo called `socialos`. Don't initialize with README — you're going to push one.
- [ ] Create a new Supabase project. Note the project URL, anon key, and service role key.
- [ ] Create a new Vercel project (link to the empty GitHub repo). Don't deploy yet.
- [ ] Create a Cloudinary account. Note the cloud name, API key, API secret. (Not used in Phase 0 but you'll want it for Phase 2.)
- [ ] Install locally: Node 20+, pnpm, Python 3.12+, `uv`, the Supabase CLI.

Local folder setup:

```bash
mkdir socialos && cd socialos
git init
# Drop the files from the starter pack here (CLAUDE.md, docs/, .env.example, etc.)
git add . && git commit -m "chore: initial scaffolding docs"
git remote add origin git@github.com:YOU/socialos.git
git push -u origin main
```

Now open Claude Code from inside `socialos/`.

---

## Goal

After this phase, the app can do these things and nothing else:

- Sign up with email + password (email verification on)
- Log in with email + password
- Log out
- View `/dashboard`, which shows "Hello, {user.email}"
- Be redirected to `/login` when visiting `/dashboard` while logged out
- Be redirected to `/dashboard` when visiting `/login` while logged in
- Be deployed at the Vercel URL, using the real Supabase project

Google OAuth login is **not** in this phase. Onboarding wizard is **not** in this phase. Brand config is **not** in this phase. Those are Phase 1.

---

## Scope — what IS in this phase

- `web/` — Next.js 15 app scaffold with TypeScript, Tailwind, shadcn/ui
- Supabase client setup (server, admin, middleware)
- Auth pages: `/login`, `/signup`, route group `(auth)`
- Protected route group `(app)` with a layout that checks auth
- `/dashboard` page (trivial content)
- Root layout with a minimal top bar (just user email + logout)
- Supabase migration `0001_foundation.sql` creating `profiles`, `workspaces`, `workspace_members` tables with RLS
- A trigger that creates a `profile`, a default `workspace`, and a `workspace_members` row automatically when a new `auth.users` row is inserted
- `supabase gen types typescript` wired up, output to `web/lib/db/types.ts`
- `.env.example` at repo root, `.env.local` with dev values
- ESLint + Prettier configs
- Basic CI: `pnpm typecheck` and `pnpm test` run on PR (GitHub Actions)
- Deploy to Vercel with env vars set

## Scope — what is NOT in this phase

- Onboarding wizard (Phase 1)
- `brand_configs` or `prompt_versions` tables (Phase 1)
- OAuth connection to LinkedIn or X (Phase 1)
- The Python worker — don't even create the `worker/` folder (Phase 2)
- Chat UI, queue UI, settings UI (later phases)
- Google OAuth login (Phase 1 or later — email/password is enough to move forward)
- Sentry, observability tooling (Phase 6)

---

## Files to create

```
web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                     # Landing / marketing page (1 paragraph stub is fine)
│   ├── (auth)/
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   └── auth/callback/route.ts   # Supabase email-confirm landing
│   └── (app)/
│       ├── layout.tsx               # Calls supabase.auth.getUser(); redirects if null
│       └── dashboard/page.tsx
├── components/
│   ├── ui/                          # shadcn components added via CLI (button, input, etc.)
│   └── app/
│       └── TopBar.tsx
├── lib/
│   ├── supabase/
│   │   ├── server.ts
│   │   ├── admin.ts
│   │   └── middleware.ts
│   └── db/
│       ├── types.ts                 # Generated — do not edit by hand
│       └── workspaces.ts
├── middleware.ts                    # Refreshes Supabase session on every request
├── tests/
│   └── smoke.test.ts                # Tests that the types file compiles, basically
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── eslint.config.mjs
├── next.config.ts
└── tailwind.config.ts

supabase/
└── migrations/
    └── 0001_foundation.sql

.github/
└── workflows/
    └── ci.yml
```

## Files to modify

- `.env.example` — confirm every var used is listed
- `docs/DATA_MODEL.md` — add `profiles`, `workspaces`, `workspace_members` (create the file if not present)
- `docs/API_CONTRACTS.md` — create, empty is fine (no custom endpoints yet)
- `CLAUDE.md` — when done, bump "Current phase" to Phase 1
- `README.md` — write a 10-line quickstart

---

## Data model — exact SQL for this phase

Put this in `supabase/migrations/0001_foundation.sql`:

```sql
-- Profiles: one per user, extends auth.users
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_self_select" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- Workspaces: each user has one in V1, but the model supports many in V2
CREATE TABLE public.workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- Membership: who belongs to which workspace
CREATE TABLE public.workspace_members (
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_self_select" ON public.workspace_members
  FOR SELECT USING (user_id = auth.uid());

-- Workspaces are readable by their members
CREATE POLICY "workspaces_member_select" ON public.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- Helper function for use in later policies
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$;

-- Trigger: on new user, create profile + workspace + membership
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

  INSERT INTO public.workspaces (name)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)) || '''s workspace')
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

Then regenerate types:

```bash
supabase gen types typescript --project-id YOUR_PROJECT_REF > web/lib/db/types.ts
```

---

## API contract

No custom endpoints in Phase 0. Supabase Auth handles signup, login, logout, and the email confirmation callback. The only server-side auth code we write is the middleware that refreshes the session.

---

## Acceptance criteria

Tick these one by one. Do not declare the phase done until all are green.

- [ ] `pnpm --dir web dev` starts the app locally on :3000
- [ ] Signing up with a new email + password creates a user in Supabase Auth
- [ ] The trigger fires: a `profiles` row, a `workspaces` row, and a `workspace_members` row are created
- [ ] After email confirmation, the user can log in at `/login`
- [ ] Logged-in user hitting `/login` is redirected to `/dashboard`
- [ ] Logged-out user hitting `/dashboard` is redirected to `/login`
- [ ] `/dashboard` renders "Hello, {user.email}"
- [ ] Logout button logs out and redirects to `/login`
- [ ] `pnpm --dir web typecheck` passes with zero errors
- [ ] `pnpm --dir web test` passes (the smoke test is allowed to be trivial)
- [ ] CI workflow passes on a test PR
- [ ] Vercel deployment succeeds; the public URL works end-to-end with signup and login
- [ ] `.env.example` has every variable the app reads, with empty values
- [ ] `docs/DATA_MODEL.md` includes the three tables from this phase
- [ ] `CLAUDE.md` updated: "Current phase" now says Phase 1
- [ ] `docs/SESSION_NOTES.md` has a new entry summarizing what got built

---

## Known pitfalls

**Supabase SSR is finicky.** You must use `@supabase/ssr` (not `@supabase/auth-helpers-nextjs`, which is deprecated). The server client uses `cookies()` from `next/headers`. The pattern is documented but easy to get wrong — if you see "cookies called outside request scope," you've imported the server client into a Client Component.

**Middleware must run on every request that needs auth.** The `middleware.ts` matcher should exclude static assets but include all app routes. A common mistake is excluding `/api` — don't, because API routes also need the session refreshed.

**Email confirmation requires a redirect URL.** In the Supabase dashboard, set "Site URL" to your Vercel URL and add `http://localhost:3000` to "Redirect URLs" for local dev. Without this, the confirmation link will 404.

**RLS is deny-by-default.** Once you enable RLS on a table, no one can read or write it until a policy allows them. Forgetting policies on `workspaces` is the likely cause if the dashboard shows a blank name.

**`supabase gen types` needs network access.** If you're generating types against a remote project, you need to be logged in via `supabase login` and linked via `supabase link`. Commit the generated file.

**The trigger function needs `SECURITY DEFINER`.** Without it, the function runs as the signing-up user, who has no permission to insert into `public.workspaces`. Double-check this one — if signup succeeds but no workspace row shows up, this is the reason.

**Tailwind v4 and shadcn/ui setup order.** Install Tailwind before running `npx shadcn@latest init`, otherwise init complains. Use the Next.js-specific shadcn setup doc, not the generic one.

---

## When the phase is done

1. All acceptance criteria checked.
2. Everything committed and pushed.
3. Vercel deployment confirmed working.
4. `CLAUDE.md` updated to Phase 1.
5. `docs/phases/PHASE_1_AUTH_BRAND.md` written as the next brief. (You can ask Claude to draft it based on the PRD sections 7.1 and 7.5.)
6. Write a 5-line entry in `docs/SESSION_NOTES.md`: what was built, any decisions made, what's next.

Then close the session cleanly. Do not start Phase 1 in the same session unless you have plenty of limit left — better to come back fresh.