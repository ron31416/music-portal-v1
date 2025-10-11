// src/lib/supabase.ts
// Browser (public) Supabase client. Do NOT import in server code.
// For server-side access, use src/lib/supabaseAdmin.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envClient } from "./envClient";

export const supabase: SupabaseClient = createClient(
  envClient.NEXT_PUBLIC_SUPABASE_URL,
  envClient.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,   // no auth flow yet
      autoRefreshToken: false, // keep browser client inert
      detectSessionInUrl: false,
    },
  }
);
