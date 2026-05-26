# Implementation Plan: Multi-Post Campaign Planner & Timeline

This plan implements **Phase A: Multi-Post Campaign Planner & Timeline**, shifting SocialOS from a single-post writer to a multi-day narrative sequence generator (e.g. Teaser → Announcement → Deep Dive).

## Proposed Changes

### Database Migration

#### [NEW] [0020_campaign_multi_post.sql](file:///c:/Users/abhishek%20jyotiba/OneDrive/Desktop/Socialio/supabase/migrations/0020_campaign_multi_post.sql)
Add metadata columns to `post_variants` to support sequencing within a campaign:
- `label` (`TEXT`): The narrative stage of the post (e.g., `'Teaser'`, `'Launch'`, `'Deep Dive'`)
- `sequence_order` (`INTEGER`): Order of the post within the campaign timeline (1, 2, 3...)
- `relative_days` (`INTEGER`): Days offset from the campaign start date (e.g. 0, 2, 5)

```sql
ALTER TABLE public.post_variants
  ADD COLUMN label TEXT,
  ADD COLUMN sequence_order INTEGER,
  ADD COLUMN relative_days INTEGER;
```

---

### Python Worker

#### [MODIFY] [generate.py](file:///c:/Users/abhishek%20jyotiba/OneDrive/Desktop/Socialio/worker/pipeline/generate.py)
- Modify the generation prompt to accept a `campaign_type` parameter (`'single'` or `'sequence'`).
- If `'sequence'` is selected, instruct the LLM to output a JSON list of posts, each with:
  - `label`: Narrative stage name
  - `sequence_order`: Integer index
  - `relative_days`: Integer day offset (e.g., 0, 2, 4)
  - `platform`: `'linkedin'` or `'x'`
  - `body`: Post body text
- Maintain the Groq primary and Gemini fallback logic.

#### [MODIFY] [campaigns.py (route)](file:///c:/Users/abhishek%20jyotiba/OneDrive/Desktop/Socialio/worker/routes/campaigns.py)
- Update `CampaignRequest` model to accept `campaign_type: Literal["single", "sequence"] = "single"`.
- Update `_generate_for_persona` to pass `campaign_type` down to `generate_variants`.
- Update `create_campaign_route` to parse `label`, `sequence_order`, and `relative_days` from the LLM response, and insert them when calling `db_posts.create_post_variants`.

---

### Next.js Frontend

#### [MODIFY] [chat/page.tsx](file:///c:/Users/abhishek%20jyotiba/OneDrive/Desktop/Socialio/web/app/(app)/chat/page.tsx)
- Add a Campaign Type selector toggle (● Single Announcement vs ○ Multi-Day Sequence) in the Chat page.
- Pass this parameter (`campaign_type`) to the `/api/campaigns` call.

#### [MODIFY] [CampaignDetail.tsx](file:///c:/Users/abhishek%20jyotiba/OneDrive/Desktop/Socialio/web/app/(app)/campaigns/[id]/_components/CampaignDetail.tsx)
- Group the persona variants by their `sequence_order` or `label` to display a clean, chronological timeline of the campaign.
- Implement a **"Smart Schedule Campaign"** action:
  - Fetches the next available posting slots for X and LinkedIn.
  - Applies the `relative_days` offset to calculate target schedule dates.
  - Calls `/api/posts/[id]/schedule` for each variant in the campaign to mark them `scheduled` with their computed `scheduled_at` times.

---

## Verification Plan

### Automated Tests
- Run worker pytest tests: `cd worker && uv run pytest tests/test_campaigns_route.py`
- Run web unit tests: `pnpm --dir web test`

### Manual Verification
1. Run local development environment: `pnpm --dir web dev` and `cd worker && uv run fastapi dev`
2. Open Chat, select "Multi-Day Sequence" toggle, and paste a link.
3. Verify that the campaign page shows 3 distinct chronological steps in the timeline (Teaser, Launch, Deep Dive) for each persona.
4. Click "Smart Schedule Campaign" and verify that all posts are scheduled in the Queue at the correct days and times according to the IANA timezone and posting schedules.
