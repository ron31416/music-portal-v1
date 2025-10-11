// src/lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { envServer } from "./envServer";

// Server-side Supabase client using the service role key.
// Do NOT import this from client components.
export const supabaseAdmin: SupabaseClient = createClient(
  envServer.SUPABASE_URL,
  envServer.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
