# Phase 5 — Scheduling & Cron

The goal of Phase 5 is to make scheduled posts actually fire, keep tokens alive automatically, and give users a way to define preferred posting times rather than always picking a raw datetime.

If by the end of this phase a user can define "post at 9am and 5pm on weekdays", schedule a variant into one of those slots, and see it publish automatically without touching the app — Phase 5 is done.

---

## Goal

After this phase, a user can:

1. Go to **Settings → Posting Schedule** and configure preferred time slots per platform (e.g. "LinkedIn: Mon–Fri 9am, 12pm, 5pm")
2. When clicking **"Schedule"** on a variant card, see their next available slots offered as one-click options (plus a "pick custom time" fallback)
3. Walk away — the Vercel cron fires every 5 minutes, claims due variants, publishes them, and marks them published
4. Tokens are refreshed automatically before they expire — user never sees a needs_reauth state unless the refresh token itself is revoked

---

## Scope — what IS in this phase

- `posting_schedules` table (migration 0008)
- Settings → Posting Schedule page: add/remove slots per platform
- Updated `VariantCard` Schedule flow: shows next available slots + custom fallback
- `POST /api/cron/publish-due` — main publisher cron
- `POST /api/cron/token-expiry-check` — token refresh cron
- `vercel.json` — cron schedule config
- LinkedIn token refresh: `refreshLinkedInToken()` in adapter
- X token refresh: `refreshXToken()` in adapter (uses refresh_token if present)
- Sweeper in publish-due cron: reset `publishing` rows stuck > 10 min back to `scheduled`

## Scope — what is NOT in this phase

- Analytics / metrics pull-back (Phase 6)
- Queue dashboard beyond what already exists (Phase 6)
- AI-powered "best time" recommendations (V2)
- Media attachments on publish (images/videos — deferred from Phase 4)
- LinkedIn Company Page posting (requires LinkedIn Partner Program — V2)

---

## Data model

### `posting_schedules`

One row per workspace × platform × time slot. Stores the user's preferred posting times in their local timezone.

Migration: `supabase/migrations/0008_posting_schedules.sql`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `workspace_id` | `UUID` NOT NULL | FK `workspaces(id)`, cascade delete |
| `platform` | `TEXT` NOT NULL | CHECK `IN ('linkedin', 'x')` |
| `hour` | `INT` NOT NULL | 0–23, in user's timezone |
| `minute` | `INT` NOT NULL | 0 or 30 (half-hour slots only, for simplicity) |
| `days_of_week` | `INT[]` NOT NULL | Array of 0–6 (0=Sun, 1=Mon…6=Sat). Empty = every day |
| `timezone` | `TEXT` NOT NULL | IANA tz string, e.g. `'America/New_York'`. Default `'UTC'` |
| `is_active` | `BOOLEAN` NOT NULL | Default `true`. Soft-disable without deleting |
| `created_at` | `TIMESTAMPTZ` NOT NULL | |
| — | UNIQUE (`workspace_id`, `platform`, `hour`, `minute`, `timezone`) | No duplicate slots |

**RLS:** workspace members can select, insert, update, delete.

**Indexes:** `idx_posting_schedules_workspace`, `idx_posting_schedules_platform`.

---

## Files to create

```
web/
├── app/
│   ├── api/
│   │   └── cron/
│   │       ├── publish-due/route.ts
│   │       └── token-expiry-check/route.ts
│   └── (app)/
│       └── settings/
│           └── schedule/
│               └── page.tsx           # Posting schedule settings UI
├── lib/
│   └── db/
│       ├── posting-schedules.ts       # CRUD helpers
│       └── schedule-utils.ts          # nextSlot() — given schedules, return next UTC datetime
supabase/
└── migrations/
    └── 0008_posting_schedules.sql

web/tests/
├── db.posting-schedules.test.ts       # type-level tests
└── schedule-utils.test.ts             # unit tests for nextSlot()
```

## Files to modify

- `web/lib/adapters/linkedin.ts` — add `refreshLinkedInToken()`
- `web/lib/adapters/x.ts` — add `refreshXToken()`
- `web/app/(app)/chat/_components/VariantCard.tsx` — update Schedule flow to show next slots
- `web/app/(app)/settings/` layout or nav — add "Schedule" link
- `docs/DATA_MODEL.md` — add Phase 5 section
- `docs/API_CONTRACTS.md` — add Phase 5 endpoint contracts
- `CLAUDE.md` — bump to Phase 6 when done
- `docs/SESSION_NOTES.md` — new top entry
- `vercel.json` — create with cron config

---

## Core logic — `schedule-utils.ts`

The key function is `nextSlots()`: given a list of `posting_schedules` rows and a reference time (now), return the next N upcoming UTC datetimes when a post would fire.

```typescript
// Returns the next `count` slot datetimes after `after` (defaults to now)
export function nextSlots(
  schedules: PostingScheduleRow[],
  count: number = 5,
  after: Date = new Date()
): Date[]
```

Algorithm:
1. For each active schedule, compute the next occurrence of that (hour, minute, day_of_week) after `after` in the schedule's timezone
2. Convert to UTC
3. Deduplicate, sort ascending, return first `count`

This function is pure (no DB calls) and fully unit-testable.

---

## Cron routes

### `POST /api/cron/publish-due`

Runs every 5 minutes via Vercel Cron.

```
Authorization: Bearer $CRON_SECRET
```

Steps:
1. Verify `Authorization: Bearer $CRON_SECRET` — return 401 otherwise
2. **Sweeper first** — reset rows stuck in `publishing` for > 10 minutes back to `scheduled`:
   ```sql
   UPDATE post_variants
   SET status = 'scheduled'
   WHERE status = 'publishing'
     AND claimed_at < now() - interval '10 minutes'
   RETURNING id;
   ```
3. **Claim due rows** (up to 10):
   ```sql
   UPDATE post_variants
   SET status = 'publishing', claimed_at = now(), worker_id = $worker_id
   WHERE id IN (
     SELECT id FROM post_variants
     WHERE status = 'scheduled' AND scheduled_at <= now()
     ORDER BY scheduled_at
     LIMIT 10
     FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
   ```
4. For each claimed row, in parallel:
   - Get `social_connections` for the workspace + platform
   - Read access token from Vault (admin client)
   - Call `publishLinkedInPost()` or `publishTweet()`
   - Write `publish_attempts` row
   - Update variant status to `published` or `failed`
5. Return `{ swept, attempted, succeeded, failed }`

### `POST /api/cron/token-expiry-check`

Runs daily via Vercel Cron.

Steps:
1. Verify `CRON_SECRET`
2. Find connections expiring within 7 days:
   ```sql
   SELECT * FROM social_connections
   WHERE token_expires_at < now() + interval '7 days'
     AND needs_reauth = false
   ```
3. For each connection:
   - If `refresh_token_vault_id` is set → attempt refresh
   - If refresh succeeds → create new Vault secret for new access token, update `social_connections` with new vault ID and expiry
   - If refresh fails → set `needs_reauth = true`
   - If no refresh token → set `needs_reauth = true`
4. Return `{ checked, refreshed, flagged }`

---

## Token refresh — adapter additions

### LinkedIn

```typescript
// web/lib/adapters/linkedin.ts
export async function refreshLinkedInToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; newRefreshToken?: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) throw new Error(`LinkedIn token refresh failed: ${response.status}`);

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    newRefreshToken: data.refresh_token,
  };
}
```

### X

```typescript
// web/lib/adapters/x.ts
export async function refreshXToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn?: number; newRefreshToken?: string }> {
  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!response.ok) throw new Error(`X token refresh failed: ${response.status}`);

  const data = await response.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    newRefreshToken: data.refresh_token,
  };
}
```

---

## UI — Settings → Posting Schedule

`/settings/schedule` — client component.

Shows two sections (LinkedIn, X). Each section:
- List of configured slots (e.g. "Mon–Fri 9:00 AM", "Mon–Fri 5:00 PM") with a delete button
- "Add slot" form: day picker (checkboxes for Mon–Sun), time picker (hour + :00/:30), timezone selector
- Save adds a row to `posting_schedules` via `POST /api/schedule-slots`

API routes needed:
- `GET /api/schedule-slots?platform=linkedin` — list slots for workspace
- `POST /api/schedule-slots` — create slot
- `DELETE /api/schedule-slots/[id]` — remove slot

---

## UI — VariantCard Schedule flow update

When user clicks "Schedule" on a variant card:

1. Call `GET /api/schedule-slots?platform={variant.platform}` to get their slots
2. If slots exist: show the next 3 upcoming slot datetimes as buttons (e.g. "Today 5:00 PM", "Tomorrow 9:00 AM", "Fri 12:00 PM") — clicking one calls `POST /api/posts/{id}/schedule` with that UTC datetime
3. Always show "Pick custom time →" which opens the existing `datetime-local` picker
4. If no slots configured: go straight to the custom picker (current behavior), with a hint "Configure posting schedule in Settings for quick slots"

---

## `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/cron/publish-due",
      "schedule": "*/5 * * * *"
    },
    {
      "path": "/api/cron/token-expiry-check",
      "schedule": "0 6 * * *"
    }
  ]
}
```

Both routes verify `Authorization: Bearer $CRON_SECRET` and return 401 for any unauthenticated call.

---

## Tests to write

### `web/tests/schedule-utils.test.ts`
- `nextSlots()` returns correct UTC datetimes for a simple Mon–Fri 9am slot
- Slots in non-UTC timezones are converted correctly
- Returns empty array when no active schedules
- Slots are ordered chronologically
- `count` parameter limits results

### `web/tests/db.posting-schedules.test.ts`
- Type-level tests: Row has expected columns
- Insert allows optional `days_of_week` defaulting

---

## API contracts (additions)

### GET /api/schedule-slots
Auth: authenticated user
Query: `platform: 'linkedin' | 'x'`
Response 200: `{ slots: PostingScheduleRow[]; next: string[] }` — slots config + next 5 UTC datetimes

### POST /api/schedule-slots
Auth: authenticated user
Request: `{ platform, hour, minute, days_of_week, timezone }`
Response 201: created slot row

### DELETE /api/schedule-slots/[id]
Auth: authenticated user
Response 200: `{ deleted: true }`

---

## Acceptance criteria

- [ ] Migration `0008_posting_schedules.sql` applies cleanly
- [ ] `pnpm --dir web gen:types` regenerates types with `posting_schedules`
- [ ] Settings → Posting Schedule page: can add and delete time slots
- [ ] `nextSlots()` unit tests pass — correct UTC conversion for non-UTC timezones
- [ ] VariantCard Schedule flow: shows next slots when configured, custom picker otherwise
- [ ] `POST /api/cron/publish-due` returns 401 without CRON_SECRET
- [ ] `POST /api/cron/publish-due` claims due variants, publishes, writes `publish_attempts`
- [ ] Sweeper resets stuck `publishing` rows to `scheduled`
- [ ] `POST /api/cron/token-expiry-check` refreshes LinkedIn tokens successfully
- [ ] `POST /api/cron/token-expiry-check` sets `needs_reauth = true` when refresh fails or no refresh token
- [ ] `vercel.json` present with correct cron schedule
- [ ] `pnpm --dir web typecheck` passes (0 errors)
- [ ] `pnpm --dir web test` passes

---

## Known pitfalls

**`FOR UPDATE SKIP LOCKED` requires a transaction.** The claim query must run inside a single transaction. In Supabase JS client, use `.rpc()` with a SQL function that wraps the UPDATE in a transaction, or use the service-role client to call a raw SQL function. Do not attempt this with chained `.update()` calls — they are not atomic.

**Timezone handling.** Store slot times as (hour, minute, timezone) — never as a pre-computed UTC time. User timezones change (DST) and pre-computing would silently drift. Convert to UTC only at scheduling time using the `nextSlots()` utility.

**Vercel Hobby cron minimum interval is 1 day.** `*/5 * * * *` (every 5 minutes) requires Vercel Pro. On Hobby, the minimum is daily. If still on Hobby, set the schedule to `0 * * * *` (hourly) until upgrading. Note this in the cron route — posts will be published within the hour of their scheduled time, not within 5 minutes.

**X refresh tokens.** X free-tier apps may not receive a refresh token even with `offline.access` scope — depends on the app's approval level. If `refresh_token_vault_id` is null, the token-expiry cron sets `needs_reauth = true` and the user must reconnect manually.

**publish-due cron uses admin client.** Same exception as the publish route — Vault reads require service_role. Already documented in DECISIONS.md.

---

## When the phase is done

- [ ] All acceptance criteria checked
- [ ] `docs/DATA_MODEL.md` updated with `posting_schedules`
- [ ] `docs/API_CONTRACTS.md` updated with Phase 5 endpoints
- [ ] `docs/DECISIONS.md` updated with any new architectural decisions
- [ ] `CLAUDE.md` current phase bumped to Phase 6
- [ ] `docs/SESSION_NOTES.md` has a new top entry
- [ ] Changes committed: `feat: Phase 5 — scheduling and cron publisher`
