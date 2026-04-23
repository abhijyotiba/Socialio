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
