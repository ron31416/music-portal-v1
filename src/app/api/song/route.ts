// src/app/api/song/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Buffer } from "node:buffer";
import type { NextRequest } from "next/server";

function isObjectRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v: unknown): v is number {
    return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isZipMagic(u8: Uint8Array): boolean {
    return (
        u8.length >= 4 &&
        u8[0] === 0x50 && // 'P'
        u8[1] === 0x4b && // 'K'
        (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07) &&
        (u8[3] === 0x04 || u8[3] === 0x06 || u8[3] === 0x08)
    );
}

// ---- POST /api/song  (create/update a song) ----
export async function POST(req: Request) {
    try {
        const raw = (await req.json()) as unknown;

        if (!isObjectRecord(raw)) {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        // Minimal shape checks without hard-coding a big REQUIRED_KEYS array
        const title = raw["song_title"];
        const compFirst = raw["composer_first_name"];
        const compLast = raw["composer_last_name"];
        const levelNum = raw["skill_level_number"];
        const fileName = raw["file_name"];
        const mxlB64 = raw["song_mxl_base64"];

        if (!isNonEmptyString(title)) {
            return NextResponse.json({ error: "song_title is required" }, { status: 400 });
        }
        if (!isNonEmptyString(compFirst)) {
            return NextResponse.json({ error: "composer_first_name is required" }, { status: 400 });
        }
        if (!isNonEmptyString(compLast)) {
            return NextResponse.json({ error: "composer_last_name is required" }, { status: 400 });
        }
        if (!isPositiveInt(levelNum)) {
            return NextResponse.json({ error: "skill_level_number must be a positive integer" }, { status: 400 });
        }
        if (!isNonEmptyString(fileName)) {
            return NextResponse.json({ error: "file_name is required" }, { status: 400 });
        }
        if (!isNonEmptyString(mxlB64)) {
            return NextResponse.json({ error: "song_mxl_base64 is required" }, { status: 400 });
        }

        // Decode base64 → bytes, validate ZIP, then convert to Postgres bytea hex literal (\x...)
        let mxlHex: string;
        try {
            const buf = Buffer.from(mxlB64, "base64");
            const u8 = new Uint8Array(buf);

            if (!isZipMagic(u8)) {
                return NextResponse.json(
                    { error: "payload_not_mxl_zip", message: "Song bytes must be compressed .mxl (ZIP) format." },
                    { status: 400 }
                );
            }

            mxlHex = "\\x" + Buffer.from(u8).toString("hex");
        } catch {
            return NextResponse.json(
                { error: "invalid_base64", message: "song_mxl_base64 is not valid base64." },
                { status: 400 }
            );
        }

        // Upsert with only unavoidable column names; uniqueness is handled by DB
        const { data, error } = await supabaseAdmin
            .from("song")
            .upsert(
                {
                    song_title: String(title),
                    composer_first_name: String(compFirst),
                    composer_last_name: String(compLast),
                    skill_level_number: Number(levelNum),
                    file_name: String(fileName),
                    song_mxl: mxlHex,
                    updated_datetime: new Date().toISOString(),
                },
                { onConflict: "file_name", ignoreDuplicates: false }
            )
            .select("song_id")
            .single();

        if (error) {
            // Generic unique violation response without hard-coding constraint names
            if (error.code === "23505") {
                return NextResponse.json(
                    { error: "conflict", message: "A song with these identifiers already exists." },
                    { status: 409 }
                );
            }
            return NextResponse.json(
                { error: error.message ?? "Insert/Update failed" },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true, song_id: data?.song_id }, { status: 200 });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}

// ---- GET /api/song  (list songs; server-owned ordering via DB function) ----
export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        // Pass-through of tokens only; no hard-coded column lists here
        const sort = url.searchParams.get("sort") ?? null; // e.g. "composer_last_name"
        const dirRaw = (url.searchParams.get("dir") ?? "").toLowerCase();
        const dir = dirRaw === "desc" ? "desc" : "asc";

        const limitParam = url.searchParams.get("limit");
        const limitNum = Number(limitParam);
        const limit = Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), 2000) : 1000;

        const offsetParam = url.searchParams.get("offset");
        const offsetNum = Number(offsetParam);
        const offset = Number.isFinite(offsetNum) ? Math.max(offsetNum, 0) : 0;

        // Delegate ordering & column choice to the DB function
        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sort ?? undefined,
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

        return new Response(JSON.stringify({ items: data ?? [] }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
