# Phase 6 � Polish



---

## Scope � what IS in this phase

- **Analytics & Metrics Sync:**
  - `post_metrics` data model (or columns on `post_variants`).
  - Added `getPostMetrics()` methods to `x.ts` and `linkedin.ts` adapters.
  - `POST /api/cron/pull-metrics` cron endpoint traversing recently published posts to update metrics.
- **Queue/Analytics Dashboard:**
  - A new or upgraded `/dashboard` or `/queue` UI showing stats (success rate, publish volume) and a timeline of posts.
- **Auth Enhancements:**
  - UI for "Continue with Google" on `web/app/(auth)/login/page.tsx` and `web/app/(auth)/signup/page.tsx`.
- **Infrastructure / Backlog:**
  - Update `worker/pyproject.toml` to replace `google-generativeai` with `google-genai`.
  - Rewrite `worker/adapters/gemini.py` to use the new Google Gen AI SDK.

## Scope � what is NOT in this phase

- AI-powered "best time" recommendations (V2)
- Multi-user / Team collaboration workflows (V2)
- Agency billing / Workspace switching (V2)
- Image/video attachments for publishing (deferred to V2 for simplicity, unless strictly requested)

---

## Data model

### `post_metrics` (or updating `post_variants`)

Migration: `supabase/migrations/0010_post_metrics.sql`

If creating a new table `post_metrics`:
| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` PK | `gen_random_uuid()` |
| `post_variant_id` | `UUID` | FK `post_variants(id)` UNIQUE |
| `workspace_id` | `UUID` | FK `workspaces(id)` |
| `impressions` | `INT` | Snapshot of views/impressions |
| `likes` | `INT` | Snapshot of likes/reactions |
| `comments` | `INT` | Snapshot of replies/comments |
| `shares` | `INT` | Snapshot of reposts/shares |
| `last_synced_at` | `TIMESTAMPTZ` | |

*Alternatively, we may just add these columns directly to `post_variants`.*

---

## Files to modify / create

```
web/
+-- app/
�   +-- api/
�   �   +-- cron/
�   �       +-- pull-metrics/route.ts   # New cron job
�   +-- (auth)/
�   �   +-- login/page.tsx              # Add Google OAuth button
�   �   +-- signup/page.tsx             # Add Google OAuth button
�   +-- (app)/
�   �   +-- dashboard/page.tsx          # High-level analytics and summary
�   �   +-- queue/page.tsx              # Full queue management
+-- lib/
�   +-- adapters/
�   �   +-- linkedin.ts                 # Add getPostMetrics()
�   �   +-- x.ts                        # Add getPostMetrics()
�   +-- db/
�       +-- metrics.ts                  # Helpers for metrics CRUD

worker/
+-- pyproject.toml                      # Swap generativeai for genai
+-- adapters/
    +-- gemini.py                       # Refactor to use new SDK

supabase/
+-- migrations/
    +-- 0010_post_metrics.sql
```

---

## Steps

1. **Google SDK Migration**: Update to `google-genai`, run tests, ensure generation still works perfectly.
2. **Google OAuth**: Add buttons to Auth UI, configure Supabase client-side method to login with OAuth provider `google`.
3. **Data Model**: Run `0010_post_metrics.sql` and `pnpm gen:types`.
4. **Adapter Updates**: Read documentation for X and LinkedIn APIs on fetching post metrics, implement them in the adapters.
5. **Cron Job**: Implement `/api/cron/pull-metrics`, fetching all posts published in the last 30 days and updating their metrics. 
6. **UI Dashboard**: Implement `/queue` and `/dashboard` screens to surface this data elegantly.
