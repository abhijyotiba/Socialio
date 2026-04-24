# Media Attachments in Publish Engine — Design Spec

**Date:** 2026-04-24  
**Phase:** 6 (Polish)  
**Status:** Approved

---

## Problem

The publish engine only posts text. `media_assets` are already scraped, uploaded to Cloudinary, and stored in the DB — but there is no path from that storage into a published post. LinkedIn and X both support images alongside post text; users expect to attach them.

---

## Scope

- User can select up to 4 images from scraped media assets to attach to a post variant
- User can upload an image from their device; it becomes a `media_asset` and is immediately selectable
- Selected media is persisted on the draft so scheduled posts publish with the correct images
- Both the immediate-publish route and the cron publisher attach media when publishing
- Videos are out of scope for V1 (images only)

---

## Schema

### New table: `post_variant_media`

Migration: `supabase/migrations/0010_post_variant_media.sql`

```sql
CREATE TABLE post_variant_media (
  post_variant_id  UUID NOT NULL REFERENCES post_variants(id) ON DELETE CASCADE,
  media_asset_id   UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position         INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (post_variant_id, media_asset_id)
);

ALTER TABLE post_variant_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_variant_media_workspace_access" ON post_variant_media
  USING (
    post_variant_id IN (
      SELECT id FROM post_variants WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

CREATE INDEX idx_post_variant_media_variant ON post_variant_media(post_variant_id);
```

### Existing tables — no changes

- `media_assets.ingestion_job_id` is already nullable — user-uploaded assets use `NULL`
- `post_variants` — no new columns; media lives entirely in the join table

---

## API Endpoints

### `PUT /api/posts/:id/media`

Saves the full media selection for a draft. Replaces any existing selection atomically (delete-then-insert).

**Auth:** user-scoped client, RLS enforced  
**Request body:**
```json
{ "media_asset_ids": ["uuid1", "uuid2"] }
```
Max 4 IDs. Order in the array determines `position` (0-indexed).

**Response:** `200 { "saved": true }`  
**Errors:** 400 if > 4 IDs, 404 if variant not found, 403 if wrong workspace

---

### `GET /api/posts/:id/media`

Returns current media selection for the picker UI.

**Response:**
```json
{
  "assets": [
    { "id": "uuid", "cloudinary_url": "...", "resource_type": "image", "width": 1200, "height": 630, "position": 0 }
  ]
}
```

---

### `POST /api/media/upload`

Accepts a file from the browser, uploads to Cloudinary server-side (signed upload), creates a `media_asset` row.

**Auth:** user-scoped  
**Request:** `multipart/form-data` with field `file`  
**Constraints:** images only (`image/jpeg`, `image/png`, `image/webp`, `image/gif`), max 10 MB  
**Response:** `201 { "asset": { ...media_asset_row } }`  
**Errors:** 400 for unsupported type or size exceeded

---

## Publish Engine Changes

Both publish paths read media from `post_variant_media` before calling the platform adapter.

### New shared helper: `lib/publish/upload-media.ts`

```typescript
// Fetches Cloudinary bytes and uploads to the target platform.
// Returns platform-specific IDs. Failures are non-fatal — returns empty array
// so the caller can fall back to text-only publish.
async function uploadMediaForPlatform(
  platform: "linkedin" | "x",
  accessToken: string,
  authorUrn: string | null,   // LinkedIn only
  mediaAssets: MediaAssetRow[]
): Promise<string[]>
```

### LinkedIn adapter additions

```typescript
// Step 1: register upload and get uploadUrl + assetUrn
async function registerLinkedInUpload(accessToken, authorUrn, fileSizeBytes): Promise<{ uploadUrl, assetUrn }>

// Step 2: PUT bytes to uploadUrl (no auth header — LinkedIn pre-signs it)
async function uploadBytesToLinkedIn(uploadUrl, imageBytes): Promise<void>

// publishLinkedInPost gains optional mediaUrns param
async function publishLinkedInPost(
  accessToken, authorUrn, text, idempotencyKey,
  mediaUrns?: string[]   // NEW — optional
)
```

When `mediaUrns` is provided:
- `shareMediaCategory` → `"IMAGE"` (was `"NONE"`)
- `media` array added to `shareContent` with one entry per URN

### X adapter additions

```typescript
// Upload image bytes to Twitter v1.1 media/upload endpoint
async function uploadMediaToX(accessToken, imageBytes, mimeType): Promise<string> // returns media_id

// publishTweet gains optional mediaIds param
async function publishTweet(
  accessToken, text,
  mediaIds?: string[]   // NEW — optional
)
```

When `mediaIds` is provided, tweet body gains `{ media: { media_ids: mediaIds } }`.

### Publish route (`/api/posts/:id/publish`) — modified section

```
1. [existing] Validate, claim variant, read token
2. [NEW] Fetch post_variant_media rows for variant.id ordered by position
3. [NEW] If rows exist: call uploadMediaForPlatform → collect IDs/URNs
4. [modified] Call publishLinkedInPost / publishTweet with media IDs
```

### Cron publisher — same change applied to `publishVariant()`

The `publishVariant` function in `web/app/api/cron/publish-due/route.ts` gets the same steps 2–4 above. No structural change to the cron loop.

---

## UI

### Component: Post card expanded panel

Location: `web/components/app/post-card.tsx` (or wherever the post variant card lives)

**Expanded state includes:**
- Thumbnail grid: images from the same `ingestion_job` as this variant's `content_item`, fetched on expand
- Each thumbnail: selectable (checkmark overlay), disabled at 4 selected
- "Upload from device" button: file input → `POST /api/media/upload` → appends new asset to grid, auto-selects it
- Selection changes call `PUT /api/posts/:id/media` (debounced 500ms)
- Selected count badge: "2/4 images selected"

**State management:** local React state for selection, synced to server on change.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Media upload to LinkedIn/X fails (transient) | Publish text-only; log warning in `publish_attempts.error_detail`; status = `published` |
| Cloudinary fetch of asset bytes fails | Same — text-only, warning logged |
| User uploads unsupported format | `POST /api/media/upload` returns 400 |
| File exceeds 10 MB | `POST /api/media/upload` returns 400 |
| User tries to select 5th image | UI disables further selection; no server call |
| LinkedIn `registerUpload` fails | Log error, skip media, publish text-only |

Media upload failures are intentionally non-fatal. A scheduled post should never get stuck because of a transient image upload error.

---

## Files Affected

| File | Change |
|---|---|
| `supabase/migrations/0010_post_variant_media.sql` | New migration |
| `docs/DATA_MODEL.md` | Add `post_variant_media` table docs |
| `web/lib/db/types.ts` | Regenerate after migration |
| `web/lib/db/post-variant-media.ts` | New — DB functions for the join table |
| `web/lib/publish/upload-media.ts` | New — shared media-upload helper |
| `web/lib/adapters/linkedin.ts` | Add `registerLinkedInUpload`, `uploadBytesToLinkedIn`; modify `publishLinkedInPost` |
| `web/lib/adapters/x.ts` | Add `uploadMediaToX`; modify `publishTweet` |
| `web/app/api/posts/[id]/media/route.ts` | New — GET + PUT endpoints |
| `web/app/api/media/upload/route.ts` | New — file upload endpoint |
| `web/app/api/posts/[id]/publish/route.ts` | Modified — add media fetch + upload step |
| `web/app/api/cron/publish-due/route.ts` | Modified — add media fetch + upload step |
| `web/components/app/post-card.tsx` | Modified — add media picker panel |
| `web/lib/adapters/cloudinary.ts` | Possibly — add server-side upload helper if not already present |

---

## Out of Scope

- Video attachments (V1 images only)
- Alt text per image (future — join table has room for it)
- Per-platform different media selection (same selection used for both platforms)
- Analytics on media post performance
