// app/api/songlist/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// ---- Types (no `any`) ----

type SkillLevelJoin = {
    skill_level_number: number;
    skill_level_name: string;
} | null;

type SongRowWithJoin = {
    song_id: number;
    song_title: string | null;
    composer_first_name: string | null;
    composer_last_name: string | null;
    file_name: string | null;
    skill_level_number: number;
    inserted_datetime: string; // ISO string from Postgres
    updated_datetime: string;  // ISO string from Postgres
    skill_level: SkillLevelJoin;
};

export type SongListItemFull = {
    song_id: number;
    song_title: string | null;
    composer_first_name: string | null;
    composer_last_name: string | null;
    file_name: string | null;
    skill_level_number: number;
    skill_level_name: string | null;
    inserted_datetime: string;
    updated_datetime: string;
};

// ---- Helpers ----

function reorderByIds<T extends { song_id: number }>(rows: T[], ids: number[]): T[] {
    const pos = new Map<number, number>(ids.map((id, i) => [id, i]));
    return [...rows].sort((a, b) => {
        const ia = pos.get(a.song_id);
        const ib = pos.get(b.song_id);
        if (ia === undefined || ib === undefined) {
            return 0;
        } else {
            return ia - ib;
        }
    });
}

function readSongIds(rows: unknown): number[] {
    if (!Array.isArray(rows)) {
        return [];
    }
    const out: number[] = [];
    for (const r of rows) {
        if (r && typeof r === "object" && "song_id" in r) {
            const v = (r as Record<string, unknown>)["song_id"];
            if (typeof v === "number" && Number.isFinite(v)) {
                out.push(v);
            }
        }
    }
    return out;
}

// ---- Route ----

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        // Server-side sort token + direction + paging (delegated to RPC)
        const sortParam = url.searchParams.get("sort") ?? "composer_last_name";
        const dirParamRaw = (url.searchParams.get("dir") ?? "asc").toLowerCase();
        const dirParam: "asc" | "desc" = dirParamRaw === "desc" ? "desc" : "asc";

        const limitNum = Number(url.searchParams.get("limit"));
        const limit = Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), 2000) : 1000;

        const offsetNum = Number(url.searchParams.get("offset"));
        const offset = Number.isFinite(offsetNum) ? Math.max(offsetNum, 0) : 0;

        // 1) Get ordered set from DB function (preserves full ORDER BY chain).
        const { data: orderedRows, error: orderErr } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sortParam,
            p_sort_direction: dirParam,
            p_limit: limit,
            p_offset: offset,
        });

        if (orderErr) {
            return new Response(JSON.stringify({ error: orderErr.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        const ids = readSongIds(orderedRows);
        if (ids.length === 0) {
            return new Response(JSON.stringify({ items: [] as SongListItemFull[] }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store",
                },
            });
        }

        // 2) Fetch FULL metadata for those ids (exclude the large song_mxl blob).
        const { data: fullRows, error: fullErr } = await supabaseAdmin
            .from("song")
            .select(
                `
        song_id,
        song_title,
        composer_first_name,
        composer_last_name,
        file_name,
        skill_level_number,
        inserted_datetime,
        updated_datetime,
        skill_level:skill_level_number (
          skill_level_number,
          skill_level_name
        )
      `
            )
            .in("song_id", ids);

        if (fullErr) {
            return new Response(JSON.stringify({ error: fullErr.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        const rows: SongRowWithJoin[] = Array.isArray(fullRows) ? (fullRows as unknown as SongRowWithJoin[]) : [];
        const ordered = reorderByIds(rows, ids);

        // 3) Flatten join and return full item set (still omitting song_mxl).
        const items: SongListItemFull[] = ordered.map((r) => ({
            song_id: r.song_id,
            song_title: r.song_title,
            composer_first_name: r.composer_first_name,
            composer_last_name: r.composer_last_name,
            file_name: r.file_name,
            skill_level_number: r.skill_level_number,
            skill_level_name: r.skill_level ? r.skill_level.skill_level_name : null,
            inserted_datetime: r.inserted_datetime,
            updated_datetime: r.updated_datetime,
        }));

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
