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

type SortKey = "song_title" | "composer" | "skill_level_name";

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        // sort / dir
        const sortParam = (url.searchParams.get("sort") ?? "song_title") as SortKey;
        const dirParam = (url.searchParams.get("dir") ?? "asc").toLowerCase();
        const ascending = dirParam !== "desc";

        // limit (safe parse)
        const limitRaw = url.searchParams.get("limit");
        const limitParsed = Number.parseInt(limitRaw ?? "", 10);
        const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), 2000) : 1000;
        const rangeEnd = limit - 1;

        // Build the multi-column ordering per your rules:
        // - Composer click  => last, first, title, level   (primary dir applied to "last"; others ASC)
        // - Title click     => title, last, first, level   (primary dir applied to "title"; others ASC)
        // - Level click     => level, last, first, title   (primary dir applied to "level"; others ASC)
        const orderCols: Array<{ col: string; asc: boolean }> = [];
        if (sortParam === "composer") {
            orderCols.push({ col: "composer_last_name", asc: ascending });
            orderCols.push({ col: "composer_first_name", asc: true });
            orderCols.push({ col: "song_title", asc: true });
            orderCols.push({ col: "skill_level_name", asc: true });
        } else if (sortParam === "song_title") {
            orderCols.push({ col: "song_title", asc: ascending });
            orderCols.push({ col: "composer_last_name", asc: true });
            orderCols.push({ col: "composer_first_name", asc: true });
            orderCols.push({ col: "skill_level_name", asc: true });
        } else {
            // sortParam === "skill_level_name"
            orderCols.push({ col: "skill_level_name", asc: ascending });
            orderCols.push({ col: "composer_last_name", asc: true });
            orderCols.push({ col: "composer_first_name", asc: true });
            orderCols.push({ col: "song_title", asc: true });
        }

        let query = supabaseAdmin
            .from("song")
            .select(
                "song_id, song_title, composer_first_name, composer_last_name, skill_level_name"
            )
            .range(0, rangeEnd);

        // Apply multi-column ordering in sequence
        for (const o of orderCols) {
            query = query.order(o.col, { ascending: o.asc, nullsFirst: false });
        }

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
