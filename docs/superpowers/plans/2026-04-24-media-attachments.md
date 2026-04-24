# Media Attachments in Publish Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to select up to 4 images per post variant and have those images published alongside the post text on LinkedIn and X.

**Architecture:** A `post_variant_media` join table persists the user's selection. Both the immediate-publish route and the cron publisher read this table, fetch image bytes from Cloudinary, upload them to the target platform, and pass the resulting platform media IDs into the publish call. Media upload failures are non-fatal — the post publishes text-only with a warning logged.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), Cloudinary (server-side signed upload), LinkedIn UGC Posts API, X API v2 + v1.1 media upload, Vitest, Zod, TypeScript strict.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/0011_post_variant_media.sql` | Create | Join table + RLS + index |
| `docs/DATA_MODEL.md` | Modify | Document new table |
| `web/lib/db/types.ts` | Regenerate | Run `supabase gen types typescript` |
| `web/lib/db/post-variant-media.ts` | Create | DB functions: get, set, delete selection |
| `web/lib/adapters/cloudinary.ts` | Create | Server-side Cloudinary upload (for user file uploads) |
| `web/lib/adapters/linkedin.ts` | Modify | Add `registerLinkedInUpload`, `uploadBytesToLinkedIn`; extend `publishLinkedInPost` |
| `web/lib/adapters/x.ts` | Modify | Add `uploadMediaToX`; extend `publishTweet` |
| `web/lib/publish/upload-media.ts` | Create | Shared helper: fetch Cloudinary bytes → upload to platform → return IDs |
| `web/app/api/posts/[id]/media/route.ts` | Create | GET (fetch selection) + PUT (save selection) |
| `web/app/api/media/upload/route.ts` | Create | Accept file → upload to Cloudinary → return media_asset row |
| `web/app/api/posts/[id]/publish/route.ts` | Modify | Add media fetch + upload step before platform publish call |
| `web/app/api/cron/publish-due/route.ts` | Modify | Same media step inside `publishVariant()` |
| `web/app/(app)/chat/_components/VariantCard.tsx` | Modify | Add media picker panel (thumbnail grid + upload button) |
| `web/tests/db.post-variant-media.test.ts` | Create | Type-level tests for new DB types |
| `web/tests/adapters.linkedin.test.ts` | Modify | Tests for new LinkedIn media upload functions |
| `web/tests/adapters.x.test.ts` | Modify | Tests for new X media upload function |
| `web/tests/publish.upload-media.test.ts` | Create | Tests for the shared upload-media helper |

---

## Task 1: Migration — `post_variant_media` table

**Files:**
- Create: `supabase/migrations/0011_post_variant_media.sql`
- Modify: `docs/DATA_MODEL.md`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0011_post_variant_media.sql` with this exact content:

```sql
-- post_variant_media: links media assets to post variants with ordering
CREATE TABLE public.post_variant_media (
  post_variant_id  UUID NOT NULL REFERENCES public.post_variants(id)  ON DELETE CASCADE,
  media_asset_id   UUID NOT NULL REFERENCES public.media_assets(id)   ON DELETE CASCADE,
  position         INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (post_variant_id, media_asset_id)
);

ALTER TABLE public.post_variant_media ENABLE ROW LEVEL SECURITY;

-- workspace-scoped access: user can access rows whose variant belongs to their workspace
CREATE POLICY "post_variant_media_workspace_access"
  ON public.post_variant_media
  USING (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- allow insert (selection save)
CREATE POLICY "post_variant_media_workspace_insert"
  ON public.post_variant_media
  FOR INSERT
  WITH CHECK (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

-- allow delete (replacing selection)
CREATE POLICY "post_variant_media_workspace_delete"
  ON public.post_variant_media
  FOR DELETE
  USING (
    post_variant_id IN (
      SELECT id FROM public.post_variants
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

CREATE INDEX idx_post_variant_media_variant ON public.post_variant_media(post_variant_id);
```

- [ ] **Step 2: Add table to DATA_MODEL.md**

Open `docs/DATA_MODEL.md`. Find the end of the "Phase 4 — Publishing" section (after the `publish_attempts` table). Add this new section before "Phase 5 — Scheduling":

```markdown
### `post_variant_media`

Join table linking media assets to post variants. Persists the user's media selection so scheduled posts publish with the correct images.

| Column | Type | Notes |
|---|---|---|
| `post_variant_id` | `UUID` | FK `post_variants(id)`, CASCADE delete. Part of PK. |
| `media_asset_id` | `UUID` | FK `media_assets(id)`, CASCADE delete. Part of PK. |
| `position` | `INT` NOT NULL | 0-indexed display order. Max 4 rows per `post_variant_id`. |
| — | PRIMARY KEY (`post_variant_id`, `media_asset_id`) | |

**RLS**

- `post_variant_media_workspace_access` — workspace members can read rows via post_variants.workspace_id.
- `post_variant_media_workspace_insert` — workspace members can insert.
- `post_variant_media_workspace_delete` — workspace members can delete.

**Indexes:** `idx_post_variant_media_variant` on `post_variant_id`.
```

- [ ] **Step 3: Regenerate TypeScript types**

Run from the repo root:

```bash
npx supabase gen types typescript --local > web/lib/db/types.ts
```

If you don't have a local Supabase running, run the migration against your Supabase project first:

```bash
npx supabase db push
npx supabase gen types typescript --project-id <your-project-id> > web/lib/db/types.ts
```

The generated file should now contain a `post_variant_media` entry under `Tables`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_post_variant_media.sql docs/DATA_MODEL.md web/lib/db/types.ts
git commit -m "feat: add post_variant_media table and regenerate types"
```

---

## Task 2: DB layer — `post-variant-media.ts`

**Files:**
- Create: `web/lib/db/post-variant-media.ts`
- Create: `web/tests/db.post-variant-media.test.ts`

- [ ] **Step 1: Write the failing type test**

Create `web/tests/db.post-variant-media.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { Database } from "@/lib/db/types";

type Row = Database["public"]["Tables"]["post_variant_media"]["Row"];

describe("post_variant_media types", () => {
  it("Row has expected columns", () => {
    expectTypeOf<Row>().toHaveProperty("post_variant_id");
    expectTypeOf<Row>().toHaveProperty("media_asset_id");
    expectTypeOf<Row>().toHaveProperty("position");
  });

  it("post_variant_id and media_asset_id are strings (UUIDs)", () => {
    expectTypeOf<Row["post_variant_id"]>().toEqualTypeOf<string>();
    expectTypeOf<Row["media_asset_id"]>().toEqualTypeOf<string>();
  });

  it("position is a number", () => {
    expectTypeOf<Row["position"]>().toEqualTypeOf<number>();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm vitest run tests/db.post-variant-media.test.ts
```

Expected: FAIL — `post_variant_media` not in types yet (or PASS if types already regenerated in Task 1).

- [ ] **Step 3: Create the DB module**

Create `web/lib/db/post-variant-media.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type Row = Database["public"]["Tables"]["post_variant_media"]["Row"];

export type MediaSelection = {
  media_asset_id: string;
  position: number;
  cloudinary_url: string;
  resource_type: string;
  width: number | null;
  height: number | null;
  format: string | null;
};

// Returns the ordered media selection for a variant, joined with asset details.
export async function getVariantMedia(
  postVariantId: string
): Promise<MediaSelection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variant_media")
    .select(
      "media_asset_id, position, media_assets(cloudinary_url, resource_type, width, height, format)"
    )
    .eq("post_variant_id", postVariantId)
    .order("position");
  if (error || !data) return [];
  return data.map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join shape
    const asset = (row as any).media_assets;
    return {
      media_asset_id: row.media_asset_id,
      position: row.position,
      cloudinary_url: asset?.cloudinary_url ?? "",
      resource_type: asset?.resource_type ?? "image",
      width: asset?.width ?? null,
      height: asset?.height ?? null,
      format: asset?.format ?? null,
    };
  });
}

// Replaces the full media selection for a variant atomically.
// mediaAssetIds: ordered array of asset IDs (index = position). Max 4.
export async function setVariantMedia(
  postVariantId: string,
  mediaAssetIds: string[]
): Promise<void> {
  if (mediaAssetIds.length > 4) {
    throw new Error("Maximum 4 media attachments per post variant");
  }
  const supabase = await createClient();

  // Delete existing selection first, then insert new one.
  const { error: deleteError } = await supabase
    .from("post_variant_media")
    .delete()
    .eq("post_variant_id", postVariantId);
  if (deleteError) throw deleteError;

  if (mediaAssetIds.length === 0) return;

  const rows: Database["public"]["Tables"]["post_variant_media"]["Insert"][] =
    mediaAssetIds.map((id, index) => ({
      post_variant_id: postVariantId,
      media_asset_id: id,
      position: index,
    }));

  const { error: insertError } = await supabase
    .from("post_variant_media")
    .insert(rows);
  if (insertError) throw insertError;
}

// Returns just the raw rows — used by publish engine (no join needed, just cloudinary_url).
export async function getVariantMediaRaw(
  postVariantId: string
): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variant_media")
    .select("*")
    .eq("post_variant_id", postVariantId)
    .order("position");
  if (error || !data) return [];
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && pnpm vitest run tests/db.post-variant-media.test.ts
```

Expected: PASS (type-level tests don't require a DB connection).

- [ ] **Step 5: Commit**

```bash
git add web/lib/db/post-variant-media.ts web/tests/db.post-variant-media.test.ts
git commit -m "feat: add post-variant-media DB module"
```

---

## Task 3: Cloudinary adapter (server-side upload)

**Files:**
- Create: `web/lib/adapters/cloudinary.ts`

This adapter is used by `POST /api/media/upload` to upload a user-provided file to Cloudinary via the signed upload API. We do **not** use the Cloudinary SDK — just a direct signed POST to avoid a new dependency.

- [ ] **Step 1: Write the adapter**

Create `web/lib/adapters/cloudinary.ts`:

```typescript
import crypto from "crypto";
import { z } from "zod";

const UploadResponseSchema = z.object({
  public_id: z.string(),
  secure_url: z.string(),
  resource_type: z.string(),
  format: z.string(),
  bytes: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export type CloudinaryUploadResult = z.infer<typeof UploadResponseSchema>;

function buildSignature(params: Record<string, string>, apiSecret: string): string {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHash("sha256").update(sorted + apiSecret).digest("hex");
}

// Uploads a file buffer to Cloudinary using signed server-side upload.
// folder: Cloudinary folder name (e.g. "user-uploads/<workspace_id>")
export async function uploadToCloudinary(
  fileBuffer: Buffer,
  mimeType: string,
  folder: string
): Promise<CloudinaryUploadResult> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME!;
  const apiKey = process.env.CLOUDINARY_API_KEY!;
  const apiSecret = process.env.CLOUDINARY_API_SECRET!;

  const timestamp = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    folder,
    resource_type: "image",
    timestamp,
  };
  const signature = buildSignature(params, apiSecret);

  const form = new FormData();
  form.append("file", new Blob([fileBuffer], { type: mimeType }));
  form.append("api_key", apiKey);
  form.append("timestamp", timestamp);
  form.append("folder", folder);
  form.append("resource_type", "image");
  form.append("signature", signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: form }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Cloudinary upload failed: ${response.status} ${text}`);
  }

  return UploadResponseSchema.parse(await response.json());
}
```

- [ ] **Step 2: Run existing tests to confirm nothing broke**

```bash
cd web && pnpm vitest run
```

Expected: all existing tests PASS (new file has no side effects).

- [ ] **Step 3: Commit**

```bash
git add web/lib/adapters/cloudinary.ts
git commit -m "feat: add Cloudinary server-side upload adapter"
```

---

## Task 4: LinkedIn media upload functions

**Files:**
- Modify: `web/lib/adapters/linkedin.ts`
- Modify: `web/tests/adapters.linkedin.test.ts`

LinkedIn requires a 3-step flow: (1) register the upload to get an upload URL + asset URN, (2) PUT the image bytes to that URL, (3) include the URN in the post body.

- [ ] **Step 1: Write the failing tests**

Open `web/tests/adapters.linkedin.test.ts`. Add these tests at the bottom (after the existing `describe` block):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- existing imports and tests above ---

describe("buildLinkedInMediaBody", () => {
  it("sets shareMediaCategory to NONE when no mediaUrns provided", () => {
    // We'll test the body builder by importing a helper — see Step 2.
    // For now this test imports the function we're about to write.
    const { buildLinkedInPostBody } = require("@/lib/adapters/linkedin");
    const body = buildLinkedInPostBody("urn:li:person:123", "Hello world", undefined);
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory).toBe("NONE");
    expect(body.specificContent["com.linkedin.ugc.ShareContent"].media).toBeUndefined();
  });

  it("sets shareMediaCategory to IMAGE and includes media array when urns provided", () => {
    const { buildLinkedInPostBody } = require("@/lib/adapters/linkedin");
    const body = buildLinkedInPostBody("urn:li:person:123", "Hello world", [
      "urn:li:digitalmediaAsset:ABC",
      "urn:li:digitalmediaAsset:DEF",
    ]);
    const content = body.specificContent["com.linkedin.ugc.ShareContent"];
    expect(content.shareMediaCategory).toBe("IMAGE");
    expect(content.media).toHaveLength(2);
    expect(content.media[0].media).toBe("urn:li:digitalmediaAsset:ABC");
    expect(content.media[1].media).toBe("urn:li:digitalmediaAsset:DEF");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm vitest run tests/adapters.linkedin.test.ts
```

Expected: FAIL — `buildLinkedInPostBody` not exported yet.

- [ ] **Step 3: Add media upload functions and export `buildLinkedInPostBody`**

Open `web/lib/adapters/linkedin.ts`. 

First, extract the post body construction from `publishLinkedInPost` into an exported helper, and add the new media upload functions. Replace the entire `publishLinkedInPost` function and add new functions after it:

```typescript
// Exported for testing. Builds the UGC post request body.
export function buildLinkedInPostBody(
  authorUrn: string,
  text: string,
  mediaUrns?: string[]
) {
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: mediaUrns && mediaUrns.length > 0 ? "IMAGE" : "NONE",
  };

  if (mediaUrns && mediaUrns.length > 0) {
    shareContent.media = mediaUrns.map((urn) => ({
      status: "READY",
      media: urn,
    }));
  }

  return {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": shareContent,
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };
}

const RegisterUploadResponseSchema = z.object({
  value: z.object({
    uploadMechanism: z.object({
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": z.object({
        uploadUrl: z.string(),
      }),
    }),
    asset: z.string(), // e.g. "urn:li:digitalmediaAsset:ABC123"
  }),
});

// Step 1 of LinkedIn media upload: register and get upload URL + asset URN.
export async function registerLinkedInUpload(
  accessToken: string,
  authorUrn: string,
  fileSizeBytes: number
): Promise<{ uploadUrl: string; assetUrn: string }> {
  const body = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: authorUrn,
      serviceRelationships: [
        {
          relationshipType: "OWNER",
          identifier: "urn:li:userGeneratedContent",
        },
      ],
      supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      fileSize: fileSizeBytes,
    },
  };

  const response = await fetch(
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`LinkedIn registerUpload failed: ${response.status}`);
  }

  const parsed = RegisterUploadResponseSchema.parse(await response.json());
  return {
    uploadUrl:
      parsed.value.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ].uploadUrl,
    assetUrn: parsed.value.asset,
  };
}

// Step 2 of LinkedIn media upload: PUT the image bytes to the pre-signed upload URL.
// No Authorization header — LinkedIn pre-signs the URL.
export async function uploadBytesToLinkedIn(
  uploadUrl: string,
  imageBytes: Buffer
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: imageBytes,
  });

  if (!response.ok) {
    throw new Error(`LinkedIn binary upload failed: ${response.status}`);
  }
}

export async function publishLinkedInPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  idempotencyKey: string,
  mediaUrns?: string[]
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const body = buildLinkedInPostBody(authorUrn, text, mediaUrns);

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "X-RestLi-Request-Id": idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error body shape varies
    const errorBody = await response.json().catch(() => ({}) as any);
    const errorCode = classifyLinkedInError(response.status, errorBody);
    throw Object.assign(
      new Error(`LinkedIn publish failed: ${response.status}`),
      { errorCode }
    );
  }

  const postUrn = response.headers.get("x-restli-id") ?? "";
  return {
    platformPostId: postUrn,
    platformPostUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
  };
}
```

Remove the old `publishLinkedInPost` that was there before. The rest of the file (token exchange, user info, metrics, refresh) stays unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run tests/adapters.linkedin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/adapters/linkedin.ts web/tests/adapters.linkedin.test.ts
git commit -m "feat: add LinkedIn media upload functions and extend publishLinkedInPost"
```

---

## Task 5: X media upload function

**Files:**
- Modify: `web/lib/adapters/x.ts`
- Modify: `web/tests/adapters.x.test.ts`

X uses the v1.1 `media/upload` endpoint (multipart form). Returns a `media_id_string` which is attached to the tweet body.

- [ ] **Step 1: Write the failing test**

Open `web/tests/adapters.x.test.ts`. Add at the bottom:

```typescript
describe("buildTweetBody", () => {
  it("returns text-only body when no mediaIds provided", () => {
    const { buildTweetBody } = require("@/lib/adapters/x");
    const body = buildTweetBody("Hello world", undefined);
    expect(body.text).toBe("Hello world");
    expect(body.media).toBeUndefined();
  });

  it("includes media object when mediaIds provided", () => {
    const { buildTweetBody } = require("@/lib/adapters/x");
    const body = buildTweetBody("Hello world", ["111", "222"]);
    expect(body.text).toBe("Hello world");
    expect(body.media).toEqual({ media_ids: ["111", "222"] });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm vitest run tests/adapters.x.test.ts
```

Expected: FAIL — `buildTweetBody` not exported yet.

- [ ] **Step 3: Add media upload function and export `buildTweetBody`**

Open `web/lib/adapters/x.ts`. 

Add a new `MediaUploadResponseSchema` after the existing schemas, then add `buildTweetBody` and `uploadMediaToX`, and update `publishTweet`:

```typescript
const MediaUploadResponseSchema = z.object({
  media_id_string: z.string(),
});

// Exported for testing. Builds the tweet request body.
export function buildTweetBody(
  text: string,
  mediaIds?: string[]
): Record<string, unknown> {
  const body: Record<string, unknown> = { text };
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  return body;
}

// Uploads image bytes to X's v1.1 media/upload endpoint.
// Returns the media_id_string to be attached to the tweet.
export async function uploadMediaToX(
  accessToken: string,
  imageBytes: Buffer,
  mimeType: string
): Promise<string> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([imageBytes], { type: mimeType }),
    "upload"
  );

  const response = await fetch(
    "https://upload.twitter.com/1.1/media/upload.json",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(`X media upload failed: ${response.status}`);
  }

  const data = MediaUploadResponseSchema.parse(await response.json());
  return data.media_id_string;
}

export async function publishTweet(
  accessToken: string,
  text: string,
  mediaIds?: string[]
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const response = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTweetBody(text, mediaIds)),
  });

  if (!response.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error body shape varies
    const body = await response.json().catch(() => ({}) as any);
    const errorCode = classifyXError(response.status, body);
    throw Object.assign(new Error(`X publish failed: ${response.status}`), {
      errorCode,
    });
  }

  const data = PublishResponseSchema.parse(await response.json());
  const postId = data.data.id;
  return {
    platformPostId: postId,
    platformPostUrl: `https://x.com/i/web/status/${postId}`,
  };
}
```

Remove the old `publishTweet` that was there before. The rest of the file stays unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run tests/adapters.x.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/adapters/x.ts web/tests/adapters.x.test.ts
git commit -m "feat: add X media upload function and extend publishTweet"
```

---

## Task 6: Shared publish helper — `upload-media.ts`

**Files:**
- Create: `web/lib/publish/upload-media.ts`
- Create: `web/tests/publish.upload-media.test.ts`

This module encapsulates the "fetch bytes from Cloudinary → upload to platform" logic so it can be called identically from both the publish route and the cron publisher.

- [ ] **Step 1: Write the failing tests**

Create `web/tests/publish.upload-media.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

// We test the URL-to-mime-type helper which is pure logic.
describe("mimeTypeFromUrl", () => {
  it("returns image/jpeg for .jpg URLs", () => {
    const { mimeTypeFromUrl } = require("@/lib/publish/upload-media");
    expect(mimeTypeFromUrl("https://res.cloudinary.com/demo/image/upload/photo.jpg")).toBe("image/jpeg");
  });

  it("returns image/png for .png URLs", () => {
    const { mimeTypeFromUrl } = require("@/lib/publish/upload-media");
    expect(mimeTypeFromUrl("https://example.com/img.png")).toBe("image/png");
  });

  it("returns image/webp for .webp URLs", () => {
    const { mimeTypeFromUrl } = require("@/lib/publish/upload-media");
    expect(mimeTypeFromUrl("https://example.com/img.webp")).toBe("image/webp");
  });

  it("returns image/jpeg as fallback for unknown extension", () => {
    const { mimeTypeFromUrl } = require("@/lib/publish/upload-media");
    expect(mimeTypeFromUrl("https://example.com/img")).toBe("image/jpeg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm vitest run tests/publish.upload-media.test.ts
```

Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Create the module**

Create `web/lib/publish/upload-media.ts`:

```typescript
import {
  registerLinkedInUpload,
  uploadBytesToLinkedIn,
} from "@/lib/adapters/linkedin";
import { uploadMediaToX } from "@/lib/adapters/x";

export function mimeTypeFromUrl(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "jpg":
    case "jpeg":
    default: return "image/jpeg";
  }
}

// Fetches image bytes from a Cloudinary URL.
// Returns null on failure (non-fatal — caller publishes text-only).
async function fetchImageBytes(cloudinaryUrl: string): Promise<Buffer | null> {
  try {
    const res = await fetch(cloudinaryUrl);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export type MediaForPublish = {
  cloudinary_url: string;
};

// Uploads each media asset to the target platform.
// Returns platform-specific IDs/URNs in the same order as input.
// Failures are non-fatal — logs a warning and returns empty array.
export async function uploadMediaForPlatform(
  platform: "linkedin" | "x",
  accessToken: string,
  assets: MediaForPublish[],
  authorUrn?: string // LinkedIn only
): Promise<string[]> {
  if (assets.length === 0) return [];

  const ids: string[] = [];

  for (const asset of assets) {
    try {
      const mimeType = mimeTypeFromUrl(asset.cloudinary_url);
      const imageBytes = await fetchImageBytes(asset.cloudinary_url);
      if (!imageBytes) {
        console.warn(`[upload-media] Failed to fetch bytes from ${asset.cloudinary_url} — skipping`);
        continue;
      }

      if (platform === "linkedin") {
        if (!authorUrn) throw new Error("authorUrn required for LinkedIn");
        const { uploadUrl, assetUrn } = await registerLinkedInUpload(
          accessToken,
          authorUrn,
          imageBytes.length
        );
        await uploadBytesToLinkedIn(uploadUrl, imageBytes);
        ids.push(assetUrn);
      } else {
        const mediaId = await uploadMediaToX(accessToken, imageBytes, mimeType);
        ids.push(mediaId);
      }
    } catch (err) {
      console.warn(
        `[upload-media] Media upload failed for ${asset.cloudinary_url}:`,
        err instanceof Error ? err.message : err
      );
      // Non-fatal: skip this asset, continue with others
    }
  }

  return ids;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm vitest run tests/publish.upload-media.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/lib/publish/upload-media.ts web/tests/publish.upload-media.test.ts
git commit -m "feat: add shared upload-media helper for publish engine"
```

---

## Task 7: Media API routes — GET and PUT `/api/posts/:id/media`

**Files:**
- Create: `web/app/api/posts/[id]/media/route.ts`

- [ ] **Step 1: Create the route**

Create `web/app/api/posts/[id]/media/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant } from "@/lib/db/posts";
import {
  getVariantMedia,
  setVariantMedia,
} from "@/lib/db/post-variant-media";

const putBodySchema = z.object({
  media_asset_ids: z
    .array(z.string().uuid())
    .max(4, "Maximum 4 media attachments"),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assets = await getVariantMedia(id);
  return NextResponse.json({ assets });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = putBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  await setVariantMedia(id, parsed.data.media_asset_ids);
  return NextResponse.json({ saved: true });
}
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/posts/[id]/media/route.ts
git commit -m "feat: add GET/PUT /api/posts/:id/media endpoints"
```

---

## Task 8: User file upload route — `POST /api/media/upload`

**Files:**
- Create: `web/app/api/media/upload/route.ts`

- [ ] **Step 1: Create the route**

Create `web/app/api/media/upload/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { uploadToCloudinary } from "@/lib/adapters/cloudinary";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: "Missing 'file' field" },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      {
        error: `Unsupported file type '${file.type}'. Allowed: jpeg, png, webp, gif`,
      },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File exceeds 10 MB limit" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const folder = `user-uploads/${workspace.workspace_id}`;

  let cloudinaryResult;
  try {
    cloudinaryResult = await uploadToCloudinary(buffer, file.type, folder);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Persist as a media_asset row (no ingestion_job_id — user upload)
  const { data: asset, error: dbError } = await supabase
    .from("media_assets")
    .insert({
      workspace_id: workspace.workspace_id,
      ingestion_job_id: null,
      cloudinary_url: cloudinaryResult.secure_url,
      cloudinary_id: cloudinaryResult.public_id,
      resource_type: "image",
      format: cloudinaryResult.format,
      bytes: cloudinaryResult.bytes,
      width: cloudinaryResult.width ?? null,
      height: cloudinaryResult.height ?? null,
    })
    .select()
    .single();

  if (dbError || !asset) {
    return NextResponse.json(
      { error: "Failed to save asset record" },
      { status: 500 }
    );
  }

  return NextResponse.json({ asset }, { status: 201 });
}
```

- [ ] **Step 2: Run all tests to confirm no regressions**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/media/upload/route.ts
git commit -m "feat: add POST /api/media/upload route for user file uploads"
```

---

## Task 9: Modify immediate publish route

**Files:**
- Modify: `web/app/api/posts/[id]/publish/route.ts`

Add the media fetch + upload step between "read access token" and "call platform adapter".

- [ ] **Step 1: Open the file and add the media step**

Open `web/app/api/posts/[id]/publish/route.ts`. 

Add this import at the top alongside the existing imports:

```typescript
import { getVariantMedia } from "@/lib/db/post-variant-media";
import { uploadMediaForPlatform } from "@/lib/publish/upload-media";
```

Find the `try` block inside the `POST` handler. It currently starts with:

```typescript
  try {
    let result: { platformPostId: string; platformPostUrl: string };

    if (variant.platform === "linkedin") {
      const authorUrn = `urn:li:person:${connection.platform_user_id}`;
      result = await publishLinkedInPost(
        accessToken,
        authorUrn,
        variant.body,
        idempotencyKey
      );
    } else {
      result = await publishTweet(accessToken, variant.body);
    }
```

Replace that block with:

```typescript
  try {
    let result: { platformPostId: string; platformPostUrl: string };

    // Fetch and upload any attached media assets before publishing
    const mediaAssets = await getVariantMedia(id);
    const platform = variant.platform as "linkedin" | "x";
    const authorUrn =
      platform === "linkedin"
        ? `urn:li:person:${connection.platform_user_id}`
        : undefined;

    const platformMediaIds = await uploadMediaForPlatform(
      platform,
      accessToken,
      mediaAssets,
      authorUrn
    );

    if (platform === "linkedin") {
      result = await publishLinkedInPost(
        accessToken,
        authorUrn!,
        variant.body,
        idempotencyKey,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    } else {
      result = await publishTweet(
        accessToken,
        variant.body,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    }
```

- [ ] **Step 2: Run all tests**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/posts/[id]/publish/route.ts
git commit -m "feat: attach media to immediate publish flow"
```

---

## Task 10: Modify cron publisher

**Files:**
- Modify: `web/app/api/cron/publish-due/route.ts`

The cron uses the `admin` client throughout. `getVariantMedia` uses the user-scoped client, so we need to query `post_variant_media` directly via `admin` instead, and fetch asset URLs from `media_assets`.

- [ ] **Step 1: Open the file and add the media step**

Open `web/app/api/cron/publish-due/route.ts`.

Add this import at the top:

```typescript
import { uploadMediaForPlatform } from "@/lib/publish/upload-media";
```

Find the `publishVariant` function. It currently starts the `try` block with:

```typescript
  try {
    let result: { platformPostId: string; platformPostUrl: string };

    if (platform === "linkedin") {
      const authorUrn = `urn:li:person:${connection.platform_user_id}`;
      result = await publishLinkedInPost(
        accessToken,
        authorUrn,
        variant.body,
        idempotencyKey
      );
    } else {
      result = await publishTweet(accessToken, variant.body);
    }
```

Replace it with:

```typescript
  try {
    let result: { platformPostId: string; platformPostUrl: string };

    // Fetch attached media via admin client (no user JWT in cron context)
    const { data: mediaRows } = await admin
      .from("post_variant_media")
      .select("media_asset_id, position, media_assets(cloudinary_url)")
      .eq("post_variant_id", variant.id)
      .order("position");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase join shape
    const mediaAssets = (mediaRows ?? []).map((row: any) => ({
      cloudinary_url: row.media_assets?.cloudinary_url ?? "",
    })).filter((a: { cloudinary_url: string }) => a.cloudinary_url);

    const authorUrn =
      platform === "linkedin"
        ? `urn:li:person:${connection.platform_user_id}`
        : undefined;

    const platformMediaIds = await uploadMediaForPlatform(
      platform,
      accessToken,
      mediaAssets,
      authorUrn
    );

    if (platform === "linkedin") {
      result = await publishLinkedInPost(
        accessToken,
        authorUrn!,
        variant.body,
        idempotencyKey,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    } else {
      result = await publishTweet(
        accessToken,
        variant.body,
        platformMediaIds.length > 0 ? platformMediaIds : undefined
      );
    }
```

- [ ] **Step 2: Run all tests**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/cron/publish-due/route.ts
git commit -m "feat: attach media to cron publish flow"
```

---

## Task 11: UI — Media picker in VariantCard

**Files:**
- Modify: `web/app/(app)/chat/_components/VariantCard.tsx`

Add a media picker panel that shows below the post body when expanded. The panel displays thumbnails from the ingestion job's media assets and an upload button.

- [ ] **Step 1: Add media picker state and logic to VariantCard**

Open `web/app/(app)/chat/_components/VariantCard.tsx`.

The `Variant` type and the component need to receive the ingestion job ID so we can fetch available media. We also need to track selected asset IDs and whether the picker is open.

Replace the entire file with:

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, CheckCheck, ExternalLink, Loader2, ImagePlus, X as XIcon } from "lucide-react";

type Variant = {
  id: string;
  platform: string;
  body: string;
  ingestion_job_id?: string | null;
};

type MediaAsset = {
  id: string;
  cloudinary_url: string;
  width: number | null;
  height: number | null;
};

type ActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "loadingSlots" }
  | { kind: "pickingSlot"; nextSlots: string[] }
  | { kind: "pickingTime" }
  | { kind: "scheduling" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "cancelling" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

const platformConfig: Record<string, { label: string; bg: string; text: string }> = {
  linkedin: { label: "LinkedIn", bg: "bg-[#e8f4fb]", text: "text-[#0077b5]" },
  x: { label: "X / Twitter", bg: "bg-slate-100", text: "text-slate-800" },
};

export function VariantCard({ variant }: { variant: Variant }) {
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [scheduledAt, setScheduledAt] = useState("");
  const [copied, setCopied] = useState(false);

  // Media picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [availableMedia, setAvailableMedia] = useState<MediaAsset[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const plt = platformConfig[variant.platform] ?? {
    label: variant.platform,
    bg: "bg-gray-100",
    text: "text-gray-700",
  };

  // Load existing selection + available media when picker opens
  useEffect(() => {
    if (!pickerOpen) return;
    setMediaLoading(true);

    Promise.all([
      // Fetch existing selection for this variant
      fetch(`/api/posts/${variant.id}/media`).then((r) => r.json()),
      // Fetch available media from the ingestion job
      variant.ingestion_job_id
        ? fetch(`/api/media?job_id=${variant.ingestion_job_id}`).then((r) => r.json())
        : Promise.resolve({ assets: [] }),
    ]).then(([selectionData, availableData]) => {
      const selected: MediaAsset[] = selectionData.assets ?? [];
      const available: MediaAsset[] = availableData.assets ?? [];

      // Merge: selected assets first (in order), then remaining available
      const selectedIdsSet = new Set(selected.map((a) => a.id ?? a.media_asset_id));
      const merged = [
        ...selected.map((a) => ({ id: a.media_asset_id ?? a.id, cloudinary_url: a.cloudinary_url, width: a.width, height: a.height })),
        ...available.filter((a) => !selectedIdsSet.has(a.id)),
      ];

      setAvailableMedia(merged);
      setSelectedIds(selected.map((a) => a.media_asset_id ?? a.id));
    }).finally(() => setMediaLoading(false));
  }, [pickerOpen, variant.id, variant.ingestion_job_id]);

  // Save selection to server (debounced via ref guard)
  async function saveSelection(ids: string[]) {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await fetch(`/api/posts/${variant.id}/media`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_asset_ids: ids }),
      });
    } finally {
      savingRef.current = false;
    }
  }

  function toggleAsset(assetId: string) {
    setSelectedIds((prev) => {
      const next = prev.includes(assetId)
        ? prev.filter((id) => id !== assetId)
        : prev.length < 4
        ? [...prev, assetId]
        : prev; // already at limit
      saveSelection(next);
      return next;
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/media/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? "Upload failed." });
        return;
      }
      const newAsset: MediaAsset = data.asset;
      setAvailableMedia((prev) => [newAsset, ...prev]);
      // Auto-select if under limit
      setSelectedIds((prev) => {
        if (prev.length < 4) {
          const next = [...prev, newAsset.id];
          saveSelection(next);
          return next;
        }
        return prev;
      });
    } finally {
      setUploadingMedia(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(variant.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handlePublishNow() {
    setState({ kind: "publishing" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/publish`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: data.error ?? "Publish failed." });
        return;
      }
      setState({ kind: "published", url: data.platform_post_url });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleClick() {
    setState({ kind: "loadingSlots" });
    try {
      const res = await fetch(`/api/schedule-slots?platform=${variant.platform}`);
      if (!res.ok) throw new Error();
      const body = await res.json();
      const next: string[] = body.next ?? [];
      if (next.length > 0) {
        setState({ kind: "pickingSlot", nextSlots: next.slice(0, 3) });
      } else {
        setState({ kind: "pickingTime" });
      }
    } catch {
      setState({ kind: "pickingTime" });
    }
  }

  async function scheduleAt(utcIso: string) {
    setState({ kind: "scheduling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: utcIso }),
      });
      const data = await res.json();
      if (!res.ok) {
        setState({
          kind: "error",
          message:
            data.error?.formErrors?.[0] ?? data.error ?? "Schedule failed.",
        });
        return;
      }
      setState({ kind: "scheduled", scheduledAt: data.scheduled_at });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  async function handleScheduleConfirm() {
    if (!scheduledAt) return;
    const utcDate = new Date(scheduledAt).toISOString();
    if (new Date(utcDate) <= new Date()) {
      setState({ kind: "error", message: "Scheduled time must be in the future." });
      return;
    }
    await scheduleAt(utcDate);
  }

  async function handleCancel() {
    setState({ kind: "cancelling" });
    try {
      const res = await fetch(`/api/posts/${variant.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setState({ kind: "error", message: data.error ?? "Cancel failed." });
        return;
      }
      setState({ kind: "cancelled" });
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    }
  }

  const isBusy =
    state.kind === "publishing" ||
    state.kind === "loadingSlots" ||
    state.kind === "scheduling" ||
    state.kind === "cancelling";
  const isTerminal =
    state.kind === "published" ||
    state.kind === "scheduled" ||
    state.kind === "cancelled";
  const showIdleActions =
    !isTerminal &&
    state.kind !== "pickingSlot" &&
    state.kind !== "pickingTime";

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${plt.bg} ${plt.text}`}>
          {plt.label}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-700"
        >
          {copied ? (
            <>
              <CheckCheck className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-500">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
          {variant.body}
        </p>
      </div>

      {/* Media picker */}
      {!isTerminal && (
        <div className="border-t border-slate-100 px-5 py-3">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-indigo-600"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            {selectedIds.length > 0
              ? `${selectedIds.length}/4 image${selectedIds.length > 1 ? "s" : ""} attached`
              : "Attach images"}
          </button>

          {pickerOpen && (
            <div className="mt-3 space-y-3">
              {mediaLoading ? (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading media…
                </div>
              ) : (
                <>
                  {availableMedia.length === 0 ? (
                    <p className="text-xs text-slate-400">No images found. Upload one below.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {availableMedia.map((asset) => {
                        const isSelected = selectedIds.includes(asset.id);
                        const isDisabled = !isSelected && selectedIds.length >= 4;
                        return (
                          <button
                            key={asset.id}
                            onClick={() => !isDisabled && toggleAsset(asset.id)}
                            disabled={isDisabled}
                            className={`relative h-16 w-16 overflow-hidden rounded-xl border-2 transition ${
                              isSelected
                                ? "border-indigo-500"
                                : "border-transparent"
                            } ${isDisabled ? "opacity-40 cursor-not-allowed" : "hover:border-indigo-300"}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={asset.cloudinary_url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 flex items-center justify-center bg-indigo-600/20">
                                <CheckCheck className="h-4 w-4 text-indigo-700" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Upload button */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingMedia || selectedIds.length >= 4}
                      className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
                    >
                      {uploadingMedia ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <ImagePlus className="h-3 w-3" />
                          Upload from device
                        </>
                      )}
                    </button>
                    {selectedIds.length >= 4 && (
                      <p className="mt-1 text-xs text-slate-400">4 image limit reached.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer actions */}
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
        {state.kind === "published" && (
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600">
              <CheckCheck className="h-4 w-4" />
              Published
            </span>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
            >
              View post
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {state.kind === "scheduled" && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-indigo-600">
              Scheduled for{" "}
              {new Date(state.scheduledAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
            <button
              onClick={handleCancel}
              disabled={isBusy}
              className="text-xs font-medium text-red-500 transition-colors hover:text-red-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}

        {state.kind === "cancelled" && (
          <p className="text-sm text-slate-500">Cancelled.</p>
        )}

        {state.kind === "error" && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-red-500">{state.message}</p>
            <button
              onClick={() => setState({ kind: "idle" })}
              className="ml-2 shrink-0 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
        )}

        {state.kind === "pickingSlot" && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Pick a slot
            </p>
            <div className="flex flex-wrap gap-2">
              {state.nextSlots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => scheduleAt(slot)}
                  className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-400 hover:text-indigo-600"
                >
                  {new Date(slot).toLocaleString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => setState({ kind: "pickingTime" })}
                className="text-xs font-medium text-indigo-600 hover:underline"
              >
                Custom time →
              </button>
              <button
                onClick={() => setState({ kind: "idle" })}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {state.kind === "pickingTime" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm transition-colors focus:border-indigo-500 focus:outline-none"
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              />
              <button
                onClick={handleScheduleConfirm}
                disabled={!scheduledAt}
                className="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-95 disabled:opacity-40"
              >
                Confirm
              </button>
              <button
                onClick={() => setState({ kind: "idle" })}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Configure slots in{" "}
              <a href="/settings/schedule" className="text-indigo-600 hover:underline">
                Settings
              </a>{" "}
              for one-click scheduling.
            </p>
          </div>
        )}

        {showIdleActions && (
          <div className="flex gap-2">
            <button
              onClick={handlePublishNow}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {state.kind === "publishing" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Publishing…
                </>
              ) : (
                "Publish now"
              )}
            </button>
            <button
              onClick={handleScheduleClick}
              disabled={isBusy}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
            >
              {state.kind === "loadingSlots" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading…
                </>
              ) : (
                "Schedule"
              )}
            </button>
          </div>
        )}

        {state.kind === "cancelling" && (
          <p className="text-xs text-slate-500">Cancelling…</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `GET /api/media` route for listing job media**

The picker fetches `GET /api/media?job_id=...` to list available assets. Create `web/app/api/media/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getMediaAssetsForJob } from "@/lib/db/media-assets";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const assets = await getMediaAssetsForJob(jobId);
  // Filter to only image assets (not video)
  const images = assets.filter((a) => a.resource_type === "image");
  return NextResponse.json({ assets: images });
}
```

- [ ] **Step 3: Update the chat page to pass ingestion_job_id to VariantCard**

Open `web/app/(app)/chat/page.tsx`. Find where `VariantCard` is rendered and make sure it receives the `ingestion_job_id`. The exact change depends on what data is already available — the content item has an `ingestion_job_id`, and variants are returned from `POST /api/posts`. If the variant objects returned to the UI don't include it, update the generation response to include it.

Check the current `POST /api/posts` response shape in `web/app/api/posts/route.ts` — it returns:

```typescript
return NextResponse.json({
  content_item_id: contentItem.id,
  variants: variants.map((v) => ({
    id: v.id,
    platform: v.platform,
    body: v.body,
    status: v.status,
  })),
});
```

Add `ingestion_job_id: job.id` to each variant in the response:

```typescript
return NextResponse.json({
  content_item_id: contentItem.id,
  ingestion_job_id: ingestion_job_id,      // ADD THIS
  variants: variants.map((v) => ({
    id: v.id,
    platform: v.platform,
    body: v.body,
    status: v.status,
  })),
});
```

Then in `web/app/(app)/chat/page.tsx`, wherever the variants are stored in state and passed to `VariantCard`, include the `ingestion_job_id`. The exact lines depend on the current UI state shape — grep for `VariantCard` and add `ingestion_job_id` to the variant object passed as prop.

- [ ] **Step 4: Run all tests**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add web/app/(app)/chat/_components/VariantCard.tsx web/app/api/media/route.ts web/app/api/posts/route.ts web/app/(app)/chat/page.tsx
git commit -m "feat: add media picker panel to VariantCard"
```

---

## Task 12: Final integration check

- [ ] **Step 1: Run the full test suite**

```bash
cd web && pnpm vitest run
```

Expected: all tests PASS with no errors.

- [ ] **Step 2: Run TypeScript compiler**

```bash
cd web && pnpm tsc --noEmit
```

Expected: zero type errors.

- [ ] **Step 3: Start the dev server and verify manually**

```bash
pnpm --dir web dev
```

Open `http://localhost:3000`. Sign in, go to the chat page, paste a URL with images, generate a post. Verify:
- The "Attach images" button appears on the variant card
- Clicking it shows thumbnails from the scraped images
- Selecting up to 4 images highlights them with a checkmark
- Selecting a 5th is blocked
- "Upload from device" opens a file picker; uploading adds the asset to the grid
- Clicking "Publish now" publishes the post (check the platform for the image)
- Scheduling a post with images selected then triggering the cron confirms scheduled posts also carry media

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: media attachments feature complete"
```

---

## Self-Review

**Spec coverage:**
- ✅ `post_variant_media` join table with RLS — Task 1
- ✅ `GET /api/posts/:id/media` — Task 7
- ✅ `PUT /api/posts/:id/media` — Task 7
- ✅ `POST /api/media/upload` — Task 8
- ✅ LinkedIn 3-step media upload — Tasks 4, 6
- ✅ X media upload — Tasks 5, 6
- ✅ Immediate publish route updated — Task 9
- ✅ Cron publisher updated — Task 10
- ✅ Media upload failures non-fatal (text-only fallback) — Task 6, `uploadMediaForPlatform`
- ✅ Max 4 images enforced (DB layer + UI) — Tasks 2, 11
- ✅ Local upload → Cloudinary → media_asset row — Tasks 3, 8
- ✅ UI thumbnail grid with selection — Task 11
- ✅ DATA_MODEL.md updated — Task 1
- ✅ Types regenerated — Task 1

**Type consistency check:**
- `MediaSelection` (Task 2) uses `media_asset_id` as the ID field — `getVariantMedia` returns it — picker toggles it — `setVariantMedia` receives it. ✅
- `uploadMediaForPlatform` accepts `MediaForPublish[]` with `cloudinary_url`. Both Task 9 and Task 10 feed it objects with `cloudinary_url`. ✅
- `publishLinkedInPost` signature extended with optional `mediaUrns?: string[]`. Task 9 passes `platformMediaIds` or `undefined`. ✅
- `publishTweet` extended with optional `mediaIds?: string[]`. Task 9 and 10 match. ✅
- `buildLinkedInPostBody` exported, called inside `publishLinkedInPost`. Tests import it directly. ✅
- `buildTweetBody` exported, called inside `publishTweet`. Tests import it directly. ✅
