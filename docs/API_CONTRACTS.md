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

*Endpoints will be added here as each phase ships.*