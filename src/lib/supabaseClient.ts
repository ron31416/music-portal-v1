// src/lib/supabase.ts
// Browser (public) Supabase client. Do NOT import in server code.
// For server-side access, use src/lib/supabaseAdmin.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export const supabase: SupabaseClient = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,   // no auth flow yet
      autoRefreshToken: false, // keep browser client inert
      detectSessionInUrl: false,
    },
  }
);
