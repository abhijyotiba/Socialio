# API Contracts

Every custom HTTP endpoint in SocialOS is documented here. Supabase-provided endpoints (auth, realtime) are not — those are covered by the Supabase docs.

When adding a new endpoint:

1. Add its section to this file (request, response, errors, auth requirements)
2. Write a Zod schema for the request body in the route handler file
3. If the response shape is shared by the client, export the TS type from `web/lib/api-types/`

Format for each endpoint:

```
### METHOD /path
Auth: who can call this
Used by: which page/component
Request: Zod shape
Response 2xx: shape
Errors: status → meaning
Notes: any gotchas
```

---

## Phase 0

No custom endpoints. All auth flows go through Supabase's built-in endpoints.

---

## Phase 1

### GET /api/brand/config

Auth: authenticated user  
Used by: `/settings/brand` page (client fetch on mount)  
Request: none  
Response 200: full `brand_configs` row as JSON  
Errors: `401` unauthenticated, `403` no workspace, `404` brand config not yet created

---

### POST /api/brand/config

Auth: authenticated user  
Used by: onboarding `BrandStep`, `/settings/brand` save  
Request:
```ts
{
  brand_name: string        // required, min 1
  industry?: string
  website_url?: string      // valid URL or empty string
  tone_tags: string[]
  system_prompt: string     // required, min 1
}
```
Response 200:
```ts
{
  workspace_id: string
  current_prompt_version_id: string
  version_number: number
}
```
Side effects: inserts a new `prompt_versions` row; upserts `brand_configs` with the new version ID  
Errors: `400` validation, `401` unauthenticated, `403` no workspace

---

### GET /api/oauth/linkedin/start

Auth: authenticated user  
Used by: "Connect LinkedIn" button  
Request: none  
Response: `302` redirect to LinkedIn authorization URL  
Side effects: sets `linkedin_oauth_state` cookie (httpOnly, 10 min TTL)  
Errors: `401` unauthenticated, `500` configuration error

---

### GET /api/oauth/linkedin/callback

Auth: authenticated user + valid state cookie  
Used by: LinkedIn OAuth redirect  
Query params: `code: string`, `state: string`  
Response: `302` redirect to `/settings/connections?linkedin=connected`  
Side effects:
- Validates `state` against `linkedin_oauth_state` cookie
- Exchanges `code` for tokens via LinkedIn API
- Stores access/refresh tokens in Supabase Vault
- Upserts `social_connections` row with Vault reference IDs and profile metadata

Errors: `400` missing params or invalid state, `401` unauthenticated, `403` no workspace, `502` LinkedIn token exchange failed
---

## Phase 2

### POST /api/ingest

Auth: authenticated user  
Used by: `/chat` page  
Request:
```ts
{
  source_type: "url" | "text"
  source_url?: string     // required when source_type = "url", must be a valid URL
  source_text?: string    // required when source_type = "text", min 1 char
}
```
Response 200:
```ts
{
  job_id: string
  extracted_title: string
  extracted_text: string
  media: Array<{
    cloudinary_url: string
    cloudinary_id: string
    resource_type: "image" | "video"
    format: string | null
    bytes: number | null
    width: number | null
    height: number | null
  }>
}
```
Side effects: `ingestion_jobs` row created (pending → scraping → done/failed); `media_assets` rows created on success  
Errors: `400` validation, `401` unauthenticated, `403` no workspace, `422` LinkedIn URL blocked, `429` rate limit (2/min or 50/day), `502` worker error  
Notes: Phase 2 call is synchronous — the route waits for the worker before responding. Expect up to 20s for slow pages.

---

### GET /api/ingest/[job_id]

Auth: authenticated user (workspace ownership verified explicitly, not relying on RLS alone)  
Used by: any client that wants to poll ingestion status or retrieve results  
Request: none (job_id in path)  
Response 200: full `ingestion_jobs` row + `media: MediaAssetRow[]`  
Errors: `401` unauthenticated, `403` wrong workspace, `404` job not found

---

## Phase 3

### POST /api/posts

Auth: authenticated user  
Used by: `/chat` page "Generate post" button  
Request:
```ts
{
  ingestion_job_id: string   // UUID — must have stage = 'done'
  platforms: ("linkedin" | "x")[]  // at least one
}
```
Response 200:
```ts
{
  content_item_id: string
  variants: Array<{
    id: string
    platform: "linkedin" | "x"
    body: string
    status: "draft"
  }>
}
```
Side effects:
- `content_items` row created and updated with LLM summary
- `post_variants` rows created (one per platform), status = 'draft'
- `ingestion_jobs.stage` advanced: `analyzing → storing → done` (or `failed`)

Errors: `400` validation, `401` unauthenticated, `403` wrong workspace or forbidden, `404` job not found, `409` job not ready or missing brand config, `502` worker error

---

## Phase 4

### POST /api/posts/[id]/publish

Auth: authenticated user
Used by: variant card "Publish Now" button
Request: none (variant id in path)
Response 200:
```ts
{
  status: "published"
  platform_post_url: string
}
```
Side effects:
- `publish_attempts` row created (status: attempting → success or failed)
- `post_variants.status` → 'published'; `published_at`, `platform_post_id`, `platform_post_url` set

Errors: `401` unauth, `403` wrong workspace, `404` not found, `409` wrong status / already published / no connection / needs reauth, `502` platform API error

---

### POST /api/posts/[id]/schedule

Auth: authenticated user
Used by: variant card "Schedule" button
Request:
```ts
{ scheduled_at: string }  // ISO 8601, must be in the future
```
Response 200:
```ts
{ status: "scheduled"; scheduled_at: string }
```
Side effects: `post_variants.status` → 'scheduled', `scheduled_at` set

Errors: `400` invalid datetime or past date, `401`, `403`, `404`, `409` variant not in draft/failed

---

### POST /api/posts/[id]/cancel

Auth: authenticated user
Used by: variant card "Cancel" button (visible on scheduled variants)
Request: none
Response 200: `{ status: "cancelled" }`
Side effects: `post_variants.status` → 'cancelled', `scheduled_at` nulled

Errors: `401`, `403`, `404`, `409` only scheduled variants can be cancelled

---

### GET /api/oauth/x/start

Auth: authenticated user
Response: 302 redirect to X authorization URL
Side effects: sets `x_oauth_state` and `x_code_verifier` httpOnly cookies (10 min TTL)

Errors: `401`

---

### GET /api/oauth/x/callback

Auth: authenticated user + valid state cookie
Query params: `code: string`, `state: string`
Response: 302 redirect to `/settings/connections?x=connected`
Side effects: validates state + PKCE verifier, exchanges code, stores tokens in Vault, upserts `social_connections` row

Errors: `400` invalid state/code, `401`, `403`, `502` X token exchange failed
