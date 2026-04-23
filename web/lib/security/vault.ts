// Supabase Vault helpers — token en/decryption via the vault extension.
// Callers must supply an admin client (service_role) because the underlying
// SQL functions are REVOKE'd from all other roles.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createSecret(
  client: SupabaseClient,
  secret: string,
  name: string
): Promise<string> {
  const { data, error } = await client.rpc("vault_create_secret", {
    p_secret: secret,
    p_name: name,
  });
  if (error) throw new Error(`Vault create failed: ${error.message}`);
  return data as string;
}

export async function readSecret(
  client: SupabaseClient,
  id: string
): Promise<string> {
  const { data, error } = await client.rpc("vault_read_secret", {
    p_id: id,
  });
  if (error) throw new Error(`Vault read failed: ${error.message}`);
  return data as string;
}
