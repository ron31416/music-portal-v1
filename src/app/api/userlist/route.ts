// src/app/api/userlist/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { UserListItem } from "@/lib/types";
import { DB_SCHEMA } from "@/lib/dbSchema";

export async function GET(req: NextRequest) {
    try {
        const url = new URL(req.url);

        const sort = url.searchParams.get("sort") ?? null;
        const dirRaw = (url.searchParams.get("dir") ?? "").toLowerCase();
        const dir = dirRaw === "desc" ? "desc" : "asc";

        const { data, error } = await supabaseAdmin
            .schema(DB_SCHEMA)                 // 👈 select schema per request
            .rpc("user_list", {
                p_sort_column: sort ?? undefined,
                p_sort_direction: dir,
            });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const items = (Array.isArray(data) ? data : []) as UserListItem[];
        return NextResponse.json({ items }, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
