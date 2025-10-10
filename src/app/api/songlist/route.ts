// app/api/songlist/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SONG_COL, type SongColToken } from "@/lib/songCols";

// --- Types that mirror the DB function result (flat shape; no joins) ---

export type SongListItemFull = {
    song_id: number;
    song_title: string | null;
    composer_first_name: string | null;
    composer_last_name: string | null;
    skill_level_number: number;
    skill_level_name: string | null;
    file_name: string | null;
    inserted_datetime: string; // ISO from timestamptz
    updated_datetime: string;  // ISO from timestamptz
};

type SortDir = "asc" | "desc";
type AllowedSort = SongColToken | "skill_level_name";

// Allow-list exactly what the DB function supports
const SORT_ALLOW = new Set<AllowedSort>([
    SONG_COL.songId,
    SONG_COL.songTitle,
    SONG_COL.composerFirstName,
    SONG_COL.composerLastName,
    SONG_COL.skillLevelNumber,
    SONG_COL.fileName,
    SONG_COL.insertedDatetime,
    SONG_COL.updatedDatetime,
]);

function normalizeDir(raw: string | null): SortDir {
    const v = (raw || "").toLowerCase();
    if (v === "desc") { return "desc"; }
    return "asc";
}

function normalizeSort(raw: string | null): AllowedSort {
    const v = (raw || "") as AllowedSort;
    if (SORT_ALLOW.has(v)) { return v; }
    return SONG_COL.composerLastName;
}

function clampLimit(raw: string | null): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) { return 1000; }
    return Math.min(Math.max(n, 1), 2000);
}

function clampOffset(raw: string | null): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) { return 0; }
    return n;
}

// ---- Route ----

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        const sort = normalizeSort(url.searchParams.get("sort"));
        const dir = normalizeDir(url.searchParams.get("dir"));
        const limit = clampLimit(url.searchParams.get("limit"));
        const offset = clampOffset(url.searchParams.get("offset"));

        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sort,
            p_sort_direction: dir,
            p_limit: limit,
            p_offset: offset,
        });

        if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        // Minimal type guard: ensure array before returning
        const itemsUnknown = data as unknown;
        const items: SongListItemFull[] = Array.isArray(itemsUnknown)
            ? (itemsUnknown as SongListItemFull[])
            : [];

        return new Response(JSON.stringify({ items }), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
            },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
