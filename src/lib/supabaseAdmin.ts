import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,              // from .env.local
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // from .env.local
  { auth: { persistSession: false } }
);
