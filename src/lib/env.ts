// src/lib/env.ts
import { invariant } from "./invariant";

const {
  NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
} = process.env;

// Fail fast if anyone forgot to set up .env.local
invariant(NEXT_PUBLIC_SUPABASE_URL, "Missing NEXT_PUBLIC_SUPABASE_URL");
invariant(NEXT_PUBLIC_SUPABASE_ANON_KEY, "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: NEXT_PUBLIC_SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: NEXT_PUBLIC_SUPABASE_ANON_KEY!,
} as const;
