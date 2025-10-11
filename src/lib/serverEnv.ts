// src/lib/serverEnv.ts
import { invariant } from "./invariant";

/**
 * Server-only environment. Do NOT import this from client components.
 * Keep secrets out of the client bundle.
 */
const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

invariant(SUPABASE_URL, "Missing SUPABASE_URL");
invariant(SUPABASE_SERVICE_ROLE_KEY, "Missing SUPABASE_SERVICE_ROLE_KEY");

export const serverEnv = {
    SUPABASE_URL: SUPABASE_URL!,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_ROLE_KEY!,
} as const;
