import { createClient } from "@supabase/supabase-js";

// Server-only: uses the service-role key, which bypasses RLS.
// Only import this from server actions / server components.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
