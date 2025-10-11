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

/* =========================
   Types returned to the UI
   ========================= */

export type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

/* =========================
   Query validation (Zod)
   ========================= */

const QuerySchema = z.object({
    sort: z.string().optional(),                    // validated against VALID_TOKENS below
    dir: z.enum(["asc", "desc"]).optional(),
    limit: z
        .string()
        .transform((s) => Number(s))
        .pipe(z.number().int().min(1).max(2000))
        .optional(),
    offset: z
        .string()
        .transform((s) => Number(s))
        .pipe(z.number().int().min(0))
        .optional(),
});

type QueryInput = z.infer<typeof QuerySchema>;

function parseQuery(req: NextRequest): {
    sortToken: SortableSongColToken | null;
    dir: "asc" | "desc";
    limit: number;
    offset: number;
} {
    const url = new URL(req.url);
    const raw = {
        sort: url.searchParams.get("sort") ?? undefined,
        dir: (url.searchParams.get("dir") ?? undefined)?.toLowerCase(),
        limit: url.searchParams.get("limit") ?? undefined,
        offset: url.searchParams.get("offset") ?? undefined,
    };

    const parsed = QuerySchema.safeParse(raw);
    let sortToken: SortableSongColToken | null = null;
    let dir: "asc" | "desc" = "asc";
    let limit = 1000;
    let offset = 0;

    if (parsed.success) {
        const q: QueryInput = parsed.data;

        // Keep only allowed sortable tokens
        if (isSortableSongColToken(q.sort)) {
            sortToken = q.sort;
        }

        if (q.dir === "asc" || q.dir === "desc") {
            dir = q.dir;
        }

        if (typeof q.limit === "number") {
            limit = q.limit;
        }

        if (typeof q.offset === "number") {
            offset = q.offset;
        }
    } else {
        // If validation fails, we just fall back to defaults (no hard failure).
    }

    return { sortToken, dir, limit, offset };
}

/* =========================
   GET /api/songlist
   ========================= */

export async function GET(req: NextRequest): Promise<NextResponse<{ items: SongListItem[] } | { error: string }>> {
    try {
        const { sortToken, dir, limit, offset } = parseQuery(req);

        // Map token → SQL column name safely (or leave undefined to let the DB choose a default)
        const sortColumn: string | undefined =
            sortToken !== null ? tokenToSql[sortToken] : undefined;

        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sortColumn,
            p_sort_direction: dir,
            p_limit: limit,
            p_offset: offset,
        });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Trust the DB function to return the correct shape. Cast to our API type for the client.
        const items = (Array.isArray(data) ? data : []) as SongListItem[];

        return NextResponse.json({ items }, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
