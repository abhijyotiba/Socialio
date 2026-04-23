# Phase 4 — Publishing

The goal of Phase 4 is a working end-to-end publishing pipeline: after generation a user can click "Publish Now" or "Schedule" on any post variant, and SocialOS either publishes immediately or queues it for the cron publisher. By the end of this phase, the first real post should leave SocialOS and land on LinkedIn or X.

If by the end of this phase a user can generate a draft, click "Publish Now", and see the post live on their connected social account — Phase 4 is done.

---

## Prerequisites — before starting the session

- [ ] Phase 3 complete and verified (generation pipeline working, `content_items` + `post_variants` rows in DB)
- [x] Phase 3 cleanup done: duplicate `getBrandConfig` consolidated, `post_variants.prompt_version_id` migration applied
- [ ] LinkedIn Developer App created and approved for `w_member_social` scope (required for posting — not just reading)
- [ ] X/Twitter Developer App created with OAuth 2.0 PKCE and `tweet.write` + `users.read` + `offline.access` scopes
- [ ] `.env.local` has `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` filled in
- [ ] Supabase CLI logged in and linked
- [ ] `pnpm --dir web typecheck` passes
- [ ] `pnpm --dir web test` passes
- [ ] `cd worker && uv run pytest` passes

Helpful setup commands:

```bash
pnpm --dir web typecheck
pnpm --dir web test
cd worker && uv run pytest
```

---

## Goal

After this phase, a user can:

1. Navigate to `/chat`, paste a URL, extract content, generate variants
2. Click **"Publish Now"** on a LinkedIn or X variant → post appears live on their account within seconds
3. Click **"Schedule"** on a variant → pick a date/time → variant enters `scheduled` status in the DB
4. See variant status update in the UI (draft → publishing → published / failed)

The cron publisher that fires scheduled posts is **Phase 5**. Phase 4 only wires "Publish Now" and "Schedule" (writing `scheduled_at` + setting status to `scheduled`). The actual firing of scheduled posts comes in the next phase.

---

## Scope — what IS in this phase

- X/Twitter OAuth routes:
  - `GET /api/oauth/x/start`
  - `GET /api/oauth/x/callback`
- X/Twitter adapter: `web/lib/adapters/x.ts` — token exchange, user info, publish
- LinkedIn publish method added to existing `web/lib/adapters/linkedin.ts`
- `publish_attempts` table + migration `0007_publish_attempts.sql`
- `POST /api/posts/[id]/publish` — immediate publish route
- `POST /api/posts/[id]/schedule` — schedule route (writes `scheduled_at`, sets `status = 'scheduled'`)
- `POST /api/posts/[id]/cancel` — cancel a scheduled variant
- `web/lib/db/publish-attempts.ts` — `createPublishAttempt`, `updatePublishAttempt`, `getLatestAttempt`
- `web/lib/db/posts.ts` — add `updatePostVariant`, `getPostVariant`
- Chat UI — enable "Publish Now" and "Schedule" buttons, show live status, show error if publish fails
- Settings → Connections — add X/Twitter connection status + connect button
- Connect Step in onboarding — add X/Twitter connect option

## Scope — what is NOT in this phase

- Cron publisher that fires scheduled posts automatically (Phase 5)
- `posting_schedules` table and smart slot assignment (Phase 5)
- Token refresh cron (Phase 5)
- Media attachment on publish (images/videos from `media_assets`) — deferred to Phase 5 for simplicity; Phase 4 publishes text-only
- Queue dashboard (Phase 5)
- Analytics (Phase 6)
- LinkedIn Company Page posting (requires LinkedIn Partner Program — V2)

---

## Files to create

```
web/
├── app/
│   └── api/
│       ├── posts/
│       │   └── [id]/
│       │       ├── publish/route.ts      # POST — publish now
│       │       ├── schedule/route.ts     # POST — schedule
│       │       └── cancel/route.ts       # POST — cancel scheduled
│       └── oauth/
│           └── x/
│               ├── start/route.ts
│               └── callback/route.ts
├── lib/
│   ├── adapters/
│   │   └── x.ts                          # Token exchange, user info, publish
│   └── db/
│       └── publish-attempts.ts

supabase/
└── migrations/
    └── 0007_publish_attempts.sql

web/tests/
├── adapters.x.test.ts
└── db.publish-attempts.test.ts
```

## Files to modify

- `web/lib/adapters/linkedin.ts` — add `publishPost()` method
- `web/lib/db/posts.ts` — add `updatePostVariant`, `getPostVariant`
- `web/app/(app)/chat/page.tsx` — enable Publish Now + Schedule buttons, show live status
- `web/app/(app)/onboarding/_components/ConnectStep.tsx` — add X/Twitter connect option
- `web/app/(app)/settings/connections/page.tsx` — add X/Twitter connection card
- `web/lib/db/types.ts` — regenerated after migration
- `docs/DATA_MODEL.md` — add Phase 4 section
- `docs/API_CONTRACTS.md` — add Phase 4 endpoint contracts
- `.env.example` — add `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`
- `CLAUDE.md` — bump current phase to Phase 5 once acceptance criteria are complete

---

## Data model — exact SQL for migration 0007

Create `supabase/migrations/0007_publish_attempts.sql`:

```sql
-- Phase 4: publish attempts — audit log and idempotency guard

CREATE TABLE public.publish_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  post_variant_id  UUID NOT NULL REFERENCES public.post_variants(id) ON DELETE CASCADE,
  idempotency_key  TEXT NOT NULL,        -- = post_variant_id; sent to platform where supported
  attempt_number   INT NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'attempting'
                   CHECK (status IN ('attempting', 'success', 'failed')),
  platform_post_id TEXT,                 -- returned by platform on success
  platform_post_url TEXT,                -- direct link to the published post
  error_code       TEXT,                 -- machine-readable: TOKEN_EXPIRED, RATE_LIMITED,
                                         -- CONTENT_POLICY, INVALID_MEDIA, SERVER_ERROR, UNKNOWN
  error_detail     TEXT,                 -- raw error message for debugging
  attempted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  CONSTRAINT publish_attempts_idempotency_unique UNIQUE (idempotency_key, attempt_number)
);

ALTER TABLE public.publish_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "publish_attempts_member_select" ON public.publish_attempts
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "publish_attempts_member_insert" ON public.publish_attempts
  FOR INSERT WITH CHECK (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "publish_attempts_member_update" ON public.publish_attempts
  FOR UPDATE USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE INDEX idx_publish_attempts_variant ON public.publish_attempts(post_variant_id);
CREATE INDEX idx_publish_attempts_workspace ON public.publish_attempts(workspace_id);
CREATE INDEX idx_publish_attempts_idempotency ON public.publish_attempts(idempotency_key);
```

Also add `published_at`, `platform_post_id`, `platform_post_url`, `error_code` columns to `post_variants` if not already present. Check the current schema — if missing, add:

```sql
-- Add to 0007 or a separate 0007b migration if post_variants already exists
ALTER TABLE public.post_variants
  ADD COLUMN IF NOT EXISTS platform_post_id  TEXT,
  ADD COLUMN IF NOT EXISTS platform_post_url TEXT,
  ADD COLUMN IF NOT EXISTS error_code        TEXT;
```

Then regenerate types:

```bash
pnpm --dir web gen:types
```

---

## X/Twitter OAuth — implementation spec

X uses OAuth 2.0 PKCE (no client secret needed for the PKCE flow, but store client secret for server-side token exchange).

Required scopes: `tweet.write users.read offline.access`

`offline.access` is required to get a refresh token from X.

### `web/lib/adapters/x.ts`

```typescript
import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string(),
});

export type XTokenResponse = z.infer<typeof TokenResponseSchema>;

const UserInfoSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
  }),
});

export type XUserInfo = z.infer<typeof UserInfoSchema>;

const PublishResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    text: z.string(),
  }),
});

export function buildAuthorizationUrl(
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_REDIRECT_URI!,
    scope: "tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<XTokenResponse> {
  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.X_REDIRECT_URI!,
    code_verifier: codeVerifier,
  });

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`X token exchange failed: ${response.status}`);
  }

  return TokenResponseSchema.parse(await response.json());
}

export async function getUserInfo(accessToken: string): Promise<XUserInfo> {
  const response = await fetch(
    "https://api.twitter.com/2/users/me",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    throw new Error(`X userinfo fetch failed: ${response.status}`);
  }

  return UserInfoSchema.parse(await response.json());
}

export async function publishTweet(
  accessToken: string,
  text: string
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const response = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorCode = classifyXError(response.status, body);
    throw Object.assign(new Error(`X publish failed: ${response.status}`), {
      errorCode,
    });
  }

  const data = PublishResponseSchema.parse(await response.json());
  const postId = data.data.id;
  // username not available here; URL will be resolved later or left generic
  return {
    platformPostId: postId,
    platformPostUrl: `https://x.com/i/web/status/${postId}`,
  };
}

function classifyXError(status: number, body: unknown): string {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 403) return "CONTENT_POLICY";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}
```

### `web/app/api/oauth/x/start/route.ts`

X uses PKCE — generate a `code_verifier`, hash it to a `code_challenge`, store the verifier in a cookie.

```typescript
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { buildAuthorizationUrl } from "@/lib/adapters/x";

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = randomBytes(16).toString("hex");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const cookieStore = await cookies();
  cookieStore.set("x_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  cookieStore.set("x_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(buildAuthorizationUrl(state, codeChallenge));
}
```

### `web/app/api/oauth/x/callback/route.ts`

Same pattern as LinkedIn callback — validate state, exchange code, store tokens in Vault, upsert `social_connections`.

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForTokens, getUserInfo } from "@/lib/adapters/x";
import { createSecret } from "@/lib/security/vault";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { upsertSocialConnection } from "@/lib/db/social-connections";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code || !state) {
    return NextResponse.json({ error: "Missing code or state" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("x_oauth_state")?.value;
  const codeVerifier = cookieStore.get("x_code_verifier")?.value;

  if (!savedState || savedState !== state || !codeVerifier) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  cookieStore.delete("x_oauth_state");
  cookieStore.delete("x_code_verifier");

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }
  const workspaceId = workspace.workspace_id;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, codeVerifier);
  } catch {
    return NextResponse.json({ error: "X token exchange failed" }, { status: 502 });
  }

  const admin = createAdminClient();
  const accessVaultId = await createSecret(
    admin,
    tokens.access_token,
    `x:access:${workspaceId}`
  );

  let refreshVaultId: string | null = null;
  if (tokens.refresh_token) {
    refreshVaultId = await createSecret(
      admin,
      tokens.refresh_token,
      `x:refresh:${workspaceId}`
    );
  }

  let platformUserId: string | null = null;
  let platformUsername: string | null = null;
  try {
    const info = await getUserInfo(tokens.access_token);
    platformUserId = info.data.id;
    platformUsername = info.data.username;
  } catch {
    // Non-fatal
  }

  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await upsertSocialConnection(
    {
      workspace_id: workspaceId,
      platform: "x",
      platform_user_id: platformUserId,
      platform_username: platformUsername,
      access_token_vault_id: accessVaultId,
      refresh_token_vault_id: refreshVaultId,
      token_expires_at: tokenExpiresAt,
      needs_reauth: false,
    },
    admin
  );

  return NextResponse.redirect(
    new URL("/settings/connections?x=connected", request.url)
  );
}
```

---

## LinkedIn publish method — add to existing adapter

Add to `web/lib/adapters/linkedin.ts`:

```typescript
export async function publishLinkedInPost(
  accessToken: string,
  authorUrn: string,    // e.g. "urn:li:person:{platformUserId}"
  text: string,
  idempotencyKey: string
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "X-RestLi-Request-Id": idempotencyKey,  // LinkedIn idempotency header
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorCode = classifyLinkedInError(response.status, errorBody);
    throw Object.assign(
      new Error(`LinkedIn publish failed: ${response.status}`),
      { errorCode }
    );
  }

  // LinkedIn returns the post URN in the response header
  const postUrn = response.headers.get("x-restli-id") ?? "";
  const postId = postUrn.split(":").pop() ?? postUrn;

  return {
    platformPostId: postUrn,
    platformPostUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
  };
}

function classifyLinkedInError(status: number, body: unknown): string {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 422 || status === 400) return "CONTENT_POLICY";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}
```

---

## DB layer additions

### `web/lib/db/publish-attempts.ts`

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";

type PublishAttemptRow =
  Database["public"]["Tables"]["publish_attempts"]["Row"];
type PublishAttemptInsert =
  Database["public"]["Tables"]["publish_attempts"]["Insert"];

export async function createPublishAttempt(
  values: PublishAttemptInsert
): Promise<PublishAttemptRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("publish_attempts")
    .insert(values)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePublishAttempt(
  id: string,
  patch: Partial<PublishAttemptRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("publish_attempts")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}

export async function getLatestAttempt(
  postVariantId: string
): Promise<PublishAttemptRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("publish_attempts")
    .select("*")
    .eq("post_variant_id", postVariantId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data;
}

// Idempotency check: has this variant already been successfully published?
export async function hasSuccessfulAttempt(
  idempotencyKey: string
): Promise<boolean> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("publish_attempts")
    .select("*", { count: "exact", head: true })
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "success");
  if (error) return false;
  return (count ?? 0) > 0;
}
```

### Additions to `web/lib/db/posts.ts`

```typescript
export async function getPostVariant(
  id: string
): Promise<PostVariantRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("post_variants")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return null;
  return data;
}

export async function updatePostVariant(
  id: string,
  patch: Partial<PostVariantRow>
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("post_variants")
    .update(patch)
    .eq("id", id);
  if (error) throw error;
}
```

---

## Web route — POST /api/posts/[id]/publish

This route handles immediate publish. It reads the vault token, calls the correct platform adapter, records the attempt, and updates the variant status.

```typescript
// web/app/api/posts/[id]/publish/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";
import {
  createPublishAttempt,
  updatePublishAttempt,
  hasSuccessfulAttempt,
} from "@/lib/db/publish-attempts";
import { getSocialConnection } from "@/lib/db/social-connections";
import { readSecret } from "@/lib/security/vault";
import { publishLinkedInPost } from "@/lib/adapters/linkedin";
import { publishTweet } from "@/lib/adapters/x";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }
  const workspaceId = workspace.workspace_id;

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["draft", "failed"].includes(variant.status)) {
    return NextResponse.json(
      { error: `Cannot publish a variant with status '${variant.status}'` },
      { status: 409 }
    );
  }

  // Idempotency guard — never double-publish
  const idempotencyKey = variant.id;
  if (await hasSuccessfulAttempt(idempotencyKey)) {
    return NextResponse.json(
      { error: "This variant has already been published" },
      { status: 409 }
    );
  }

  // Verify social connection exists
  const connection = await getSocialConnection(
    workspaceId,
    variant.platform as "linkedin" | "x"
  );
  if (!connection) {
    return NextResponse.json(
      { error: `No ${variant.platform} account connected` },
      { status: 409 }
    );
  }
  if (connection.needs_reauth) {
    return NextResponse.json(
      { error: `${variant.platform} account needs re-authentication` },
      { status: 409 }
    );
  }

  // Claim the variant
  await updatePostVariant(id, { status: "publishing" });

  // Get next attempt number
  const admin = createAdminClient();
  const accessToken = await readSecret(
    admin,
    connection.access_token_vault_id!
  );

  // Write publish_attempts row
  const attempt = await createPublishAttempt({
    workspace_id: workspaceId,
    post_variant_id: id,
    idempotency_key: idempotencyKey,
    attempt_number: 1,
    status: "attempting",
  });

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

    // Success
    await updatePublishAttempt(attempt.id, {
      status: "success",
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
      completed_at: new Date().toISOString(),
    });

    await updatePostVariant(id, {
      status: "published",
      published_at: new Date().toISOString(),
      platform_post_id: result.platformPostId,
      platform_post_url: result.platformPostUrl,
    });

    return NextResponse.json({
      status: "published",
      platform_post_url: result.platformPostUrl,
    });
  } catch (err) {
    const errorCode =
      (err as { errorCode?: string }).errorCode ?? "UNKNOWN";
    const errorDetail =
      err instanceof Error ? err.message : "Unknown error";

    await updatePublishAttempt(attempt.id, {
      status: "failed",
      error_code: errorCode,
      error_detail: errorDetail,
      completed_at: new Date().toISOString(),
    });

    await updatePostVariant(id, {
      status: "failed",
      error: errorDetail,
      error_code: errorCode,
    });

    const status = errorCode === "TOKEN_EXPIRED" ? 401 : 502;
    return NextResponse.json(
      { error: errorDetail, error_code: errorCode },
      { status }
    );
  }
}
```

---

## Web route — POST /api/posts/[id]/schedule

```typescript
// web/app/api/posts/[id]/schedule/route.ts

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";

const bodySchema = z.object({
  scheduled_at: z.string().datetime(),  // ISO 8601 string, must be in the future
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { scheduled_at } = parsed.data;

  if (new Date(scheduled_at) <= new Date()) {
    return NextResponse.json(
      { error: "scheduled_at must be in the future" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const variant = await getPostVariant(id);
  if (!variant) {
    return NextResponse.json({ error: "Post variant not found" }, { status: 404 });
  }
  if (variant.workspace_id !== workspace.workspace_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["draft", "failed"].includes(variant.status)) {
    return NextResponse.json(
      { error: `Cannot schedule a variant with status '${variant.status}'` },
      { status: 409 }
    );
  }

  await updatePostVariant(id, {
    status: "scheduled",
    scheduled_at,
  });

  return NextResponse.json({ status: "scheduled", scheduled_at });
}
```

---

## Web route — POST /api/posts/[id]/cancel

```typescript
// web/app/api/posts/[id]/cancel/route.ts

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceForUser } from "@/lib/db/workspaces";
import { getPostVariant, updatePostVariant } from "@/lib/db/posts";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
  if (variant.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only scheduled variants can be cancelled" },
      { status: 409 }
    );
  }

  await updatePostVariant(id, {
    status: "cancelled",
    scheduled_at: null,
  });

  return NextResponse.json({ status: "cancelled" });
}
```

---

## Chat UI changes

The "Publish now" and "Schedule" buttons in the variant cards are currently disabled placeholders. Replace them with working implementations.

Each variant card needs local state to track its publish/schedule status independently. The key additions:

- **"Publish Now" button** — calls `POST /api/posts/{id}/publish`, shows spinner while in flight, shows "Published ✓" with a link on success, shows error message on failure
- **"Schedule" button** — opens a simple datetime picker inline (an `<input type="datetime-local">`), on confirm calls `POST /api/posts/{id}/schedule`, shows "Scheduled for {date}" on success
- **"Cancel" button** — appears on scheduled variants, calls `POST /api/posts/{id}/cancel`

Each variant card should track its own state:

```typescript
type VariantActionState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "published"; url: string }
  | { kind: "scheduling" }
  | { kind: "scheduled"; scheduledAt: string }
  | { kind: "error"; message: string };
```

Keep the component clean by extracting a `<VariantCard />` client component rather than inlining all this state into the chat page.

---

## API contracts

Add to `docs/API_CONTRACTS.md`:

```markdown
---

## Phase 4

### POST /api/posts/[id]/publish

Auth: authenticated user
Used by: variant card "Publish Now" button
Request: none (variant id in path)
Response 200:
{
  status: "published"
  platform_post_url: string
}
Side effects:
- `publish_attempts` row created and updated
- `post_variants.status` set to 'published'
- `post_variants.published_at`, `platform_post_id`, `platform_post_url` set

Errors: 401 unauth, 403 wrong workspace, 404 not found,
        409 wrong status / already published / no connection,
        502 platform API error

---

### POST /api/posts/[id]/schedule

Auth: authenticated user
Used by: variant card "Schedule" button
Request:
{
  scheduled_at: string  // ISO 8601, must be in the future
}
Response 200:
{
  status: "scheduled"
  scheduled_at: string
}
Side effects: `post_variants.status` set to 'scheduled', `scheduled_at` set
Errors: 400 validation / past date, 401, 403, 404, 409 wrong status

---

### POST /api/posts/[id]/cancel

Auth: authenticated user
Used by: variant card "Cancel" button (visible on scheduled variants)
Request: none
Response 200: { status: "cancelled" }
Side effects: `post_variants.status` set to 'cancelled', `scheduled_at` nulled
Errors: 401, 403, 404, 409 (only scheduled variants can be cancelled)

---

### GET /api/oauth/x/start

Auth: authenticated user
Request: none
Response: 302 redirect to X authorization URL
Side effects: sets `x_oauth_state` and `x_code_verifier` cookies (httpOnly, 10 min TTL)
Errors: 401

---

### GET /api/oauth/x/callback

Auth: authenticated user + valid state cookie
Query params: code: string, state: string
Response: 302 redirect to /settings/connections?x=connected
Side effects: validates state + PKCE verifier, exchanges code, stores tokens in Vault,
              upserts social_connections row
Errors: 400 invalid state/code, 401, 403, 502 X token exchange failed
```

---

## Environment variables to add

Add to `.env.example`:

```bash
# X/Twitter OAuth
X_CLIENT_ID=
X_CLIENT_SECRET=
X_REDIRECT_URI=
```

Add to `.env.local` before testing.

---

## Tests to write

### `web/tests/adapters.x.test.ts`

Mirror the shape of `adapters.linkedin.test.ts`. Cover:
- `buildAuthorizationUrl` returns correct base URL with required params
- `buildAuthorizationUrl` includes `code_challenge` and `code_challenge_method=S256`
- `buildAuthorizationUrl` includes correct scopes
- Different states produce different URLs

### `web/tests/db.publish-attempts.test.ts`

Type-level tests (mirror existing test files). Cover:
- `PublishAttemptRow` has expected columns
- `Insert` type allows optional nullable fields
- Status enum values present in type

---

## Acceptance criteria

- [ ] Migration `0007_publish_attempts.sql` applies cleanly via `pnpm --dir web supabase db push --workdir ..`
- [ ] `pnpm --dir web gen:types` regenerates types including `publish_attempts`
- [ ] X/Twitter connect flow completes through start + callback routes; `social_connections` row exists with `platform = 'x'`
- [ ] X/Twitter tokens stored as Vault references (never plaintext)
- [ ] Settings → Connections shows X/Twitter connection status
- [ ] Onboarding Connect Step shows X/Twitter option alongside LinkedIn
- [ ] "Publish Now" on a LinkedIn variant publishes a real post to LinkedIn; `post_variants.status = 'published'`
- [ ] "Publish Now" on an X variant publishes a real tweet; `post_variants.status = 'published'`
- [ ] Published variant shows a "View post →" link pointing to `platform_post_url`
- [ ] Duplicate publish attempt is blocked by `hasSuccessfulAttempt` check (returns 409)
- [ ] "Schedule" button sets `status = 'scheduled'` and `scheduled_at` in DB
- [ ] Scheduling with a past date returns 400
- [ ] "Cancel" button on a scheduled variant sets `status = 'cancelled'`
- [ ] Failed publish writes a `publish_attempts` row with `status = 'failed'` and correct `error_code`
- [ ] `post_variants.status` transitions correctly through `draft → publishing → published`
- [ ] `post_variants.status` transitions correctly through `draft → publishing → failed`
- [ ] `pnpm --dir web typecheck` passes (0 errors)
- [ ] `pnpm --dir web test` passes

---

## Known pitfalls

**LinkedIn `w_member_social` scope requires app approval.** The OAuth start route currently requests `openid profile email`. For publishing, you need to add `w_member_social` to the scope. This requires LinkedIn to approve your developer app for the "Share on LinkedIn" product. Submit the review request immediately — it takes 1–7 days. In the meantime you can test the OAuth flow itself but the publish call will return 403 until approved.

**LinkedIn post author URN.** The `publishLinkedInPost` function builds `urn:li:person:{platformUserId}`. The `platform_user_id` stored in Phase 1 is the `sub` field from the `/v2/userinfo` endpoint, which for LinkedIn OpenID is the person URN suffix. Verify this matches what the UGC Posts API expects. If not, call `/v2/userinfo` again at publish time to get the current `sub`.

**X token format.** X OAuth 2.0 PKCE access tokens are short-lived (2 hours) unless `offline.access` scope is granted. Always check that `offline.access` is in the granted scopes when storing the connection — if the refresh token is absent, the user will need to re-auth every 2 hours. The callback route should set `needs_reauth = true` if no refresh token is returned.

**X rate limits.** X free tier allows 17 tweets per 24 hours per user. Above that, publish will return 429 with `error_code = RATE_LIMITED`. Log this clearly and surface it to the user rather than retrying immediately.

**`POST /api/posts/[id]/publish` uses the admin client to read vault secrets.** The admin client import (`createAdminClient`) is only permitted in cron and OAuth callback routes per the architecture rules. Publish routes are a new exception — add a note to `docs/DECISIONS.md` acknowledging this and explaining why (vault reads require service role). Do not forget this or a CI check may flag it later when the service-role lint rule is implemented.

**Publish is synchronous.** The Vercel function timeout is 10s (Hobby) / 60s (Pro). LinkedIn and X publish calls are typically < 3s. If this becomes a problem on Hobby, upgrade before implementing the cron in Phase 5.

**`scheduled_at` timezone.** Store `scheduled_at` as UTC ISO 8601 in the DB. The UI datetime-local input gives local time — convert to UTC before sending to the API. The schedule route validates it's in the future using server time (also UTC), so this must be consistent.

**Do not implement the actual cron publisher here.** The cron that fires scheduled posts is Phase 5 scope. Phase 4 only writes `status = 'scheduled'` and `scheduled_at`. It is fine to end Phase 4 with scheduled posts sitting unexecuted in the DB.

---

## When the phase is done

- [ ] All acceptance criteria checked
- [ ] `docs/DATA_MODEL.md` updated with `publish_attempts` table and any `post_variants` column additions
- [ ] `docs/API_CONTRACTS.md` updated with Phase 4 endpoint contracts
- [ ] `docs/DECISIONS.md` updated: note that `createAdminClient` is now also used in publish routes (vault reads)
- [ ] `CLAUDE.md` current phase bumped to Phase 5
- [ ] `docs/SESSION_NOTES.md` has a new top entry summarising Phase 4 completion
- [ ] Changes committed: `feat: Phase 4 — publishing pipeline`