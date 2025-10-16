// src/app/api/songlist/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
    tokenToSql,
    isSortableSongColToken,
    type SortableSongColToken,
} from "@/lib/songCols";
import type { SongListItem, SongListResponse } from "@/lib/types";

/* =========================
   Query validation (Zod)
   ========================= */

const QuerySchema = z.object({
    sort: z.string().optional(),              // validated against isSortableSongColToken
    dir: z.enum(["asc", "desc"]).optional(),  // default asc
});

function parseQuery(req: NextRequest): {
    sortToken: SortableSongColToken | null;
    dir: "asc" | "desc";
} {
    const url = new URL(req.url);
    const raw = {
        sort: url.searchParams.get("sort") ?? undefined,
        dir: (url.searchParams.get("dir") ?? "asc").toLowerCase(),
    };

    const parsed = QuerySchema.safeParse(raw);

    let sortToken: SortableSongColToken | null = null;
    let dir: "asc" | "desc" = "asc";

    if (parsed.success) {
        const q = parsed.data;
        if (isSortableSongColToken(q.sort)) { sortToken = q.sort; }
        if (q.dir === "asc" || q.dir === "desc") { dir = q.dir; }
    }
    // If validation fails, fall back to defaults without throwing.

    return { sortToken, dir };
}

/* =========================
   GET /api/songlist
   ========================= */

export async function GET(req: NextRequest): Promise<NextResponse<SongListResponse | { error: string }>> {
    try {
        const { sortToken, dir } = parseQuery(req);

        // Map token → SQL column safely (or null to use function default)
        const sortColumn: string | null =
            sortToken !== null ? tokenToSql[sortToken] ?? null : null;

        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sortColumn,
            p_sort_direction: dir
        });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const items = (Array.isArray(data) ? data : []) as SongListItem[];

        return NextResponse.json(
            { items },
            { status: 200, headers: { "Cache-Control": "no-store" } }
        );
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
