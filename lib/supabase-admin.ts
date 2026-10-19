import "server-only";
import { createClient } from "@supabase/supabase-js";

// The ONE database client. It uses the service-role key, which can do anything, so it is only ever used
// on the server (the `server-only` import above makes the build fail if a browser file imports this).
// Pages and actions reach it only after checking that someone is logged in.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);
