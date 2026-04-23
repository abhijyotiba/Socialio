// Service-role client — bypasses RLS.
// ONLY import this from app/api/cron/* routes and app/api/oauth/*/callback/route.ts.
// Anywhere else is a security violation.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
