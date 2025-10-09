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

const ALLOWED_SORT: ReadonlyArray<keyof SongListItem> = [
    "song_title",
    "composer_last_name",
    "composer_first_name",
    "skill_level_name",
] as const;

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        // sort / dir
        const sortParam = (url.searchParams.get("sort") ?? "song_title") as keyof SongListItem;
        const dirParam = (url.searchParams.get("dir") ?? "asc").toLowerCase();
        const sort: keyof SongListItem = ALLOWED_SORT.includes(sortParam) ? sortParam : "song_title";
        const ascending = dirParam !== "desc";

        // limit (safe parse)
        const limitRaw = url.searchParams.get("limit");
        const limitParsed = Number.parseInt(limitRaw ?? "", 10);
        const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 2000) : 1000;
        const rangeEnd = limit - 1;

        const query = supabaseAdmin
            .from("song")
            .select(
                "song_id, song_title, composer_first_name, composer_last_name, skill_level_name"
            )
            .order(sort as string, { ascending })
            // stable tie-breaker
            .order("song_id", { ascending: true })
            .range(0, rangeEnd);

        const { data, error } = await query;

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
