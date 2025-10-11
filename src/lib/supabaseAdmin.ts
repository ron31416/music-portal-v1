// src/lib/supabaseAdmin.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "./serverEnv";

// Server-side Supabase client using the service role key.
// Do NOT import this from client components.
export const supabaseAdmin: SupabaseClient = createClient(
  serverEnv.SUPABASE_URL,
  serverEnv.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
