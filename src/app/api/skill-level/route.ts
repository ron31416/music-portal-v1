// app/api/skill-level/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
    try {
        const { data, error } = await supabaseAdmin
            .from('skill_level') // table name you created
            .select('skill_level_name')
            .order('skill_level_number');

        if (error) {
            return new Response(
                JSON.stringify({ error: error.message, code: error.code, hint: error.hint }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
        }

        const levels = (data ?? []).map(r => r.skill_level_name);
        return new Response(JSON.stringify({ levels }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
