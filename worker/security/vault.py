from supabase import AsyncClient


async def read_secret(client: AsyncClient, vault_id: str) -> str:
    """Decrypt a Supabase Vault secret by id. `client` must be the service-role
    client — vault_read_secret is REVOKE'd from all other roles."""
    res = await client.rpc("vault_read_secret", {"p_id": vault_id}).execute()
    return res.data


async def create_secret(client: AsyncClient, secret: str, name: str) -> str:
    """Store a new Vault secret, returning its id. Service-role client only."""
    res = await client.rpc(
        "vault_create_secret", {"p_secret": secret, "p_name": name}
    ).execute()
    return res.data
