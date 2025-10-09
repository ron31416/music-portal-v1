// app/api/songlist/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        // parse inputs from querystring (primary col token, dir, paging)
        const sortParam = url.searchParams.get("sort") ?? "composer_last_name";
        const dirParamRaw = (url.searchParams.get("dir") ?? "asc").toLowerCase();
        const dirParam = dirParamRaw === "desc" ? "desc" : "asc";

        const limitRaw = url.searchParams.get("limit");
        const limitNum = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 1000;
        const limit = Math.min(Math.max(limitNum, 1), 2000);

        const offsetRaw = url.searchParams.get("offset");
        const offsetNum = Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : 0;
        const offset = Math.max(offsetNum, 0);

        // single call to DB function; DB expands ORDER BY
        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sortParam,
            p_sort_direction: dirParam,
            p_limit: limit,
            p_offset: offset,
        });

        if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(
            JSON.stringify({ items: (data ?? []) as SongListItem[] }),
            {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                },
            }
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
