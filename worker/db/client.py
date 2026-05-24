from supabase import AsyncClient, acreate_client

from config import settings


async def rls_client(access_token: str) -> AsyncClient:
    """Supabase client scoped to a single user's JWT.

    Built with the anon key, then the user's access token is set on the
    PostgREST layer so every query runs as that user and Row-Level Security
    enforces workspace isolation. Mirrors web/lib/supabase/server.ts.
    """
    client = await acreate_client(settings.supabase_url, settings.supabase_anon_key)
    client.postgrest.auth(access_token)
    return client
