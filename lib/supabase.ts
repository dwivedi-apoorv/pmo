// Pages read the database through the same server-only client the actions use (see supabase-admin.ts).
// The public (anon) key is no longer used anywhere, so it can't be used to read your data.
export { supabaseAdmin as supabase } from "@/lib/supabase-admin";
