// app/api/song/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Buffer } from "node:buffer";
import type { PostgrestError } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

type SongPayload = {
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string; // FK → skill_level.skill_level_name
    file_name: string;        // UNIQUE guardrail against double-upload
    song_mxl_base64: string;  // base64-encoded MusicXML/MXL bytes
};

const REQUIRED_KEYS: (keyof SongPayload)[] = [
    "song_title",
    "composer_first_name",
    "composer_last_name",
    "skill_level_name",
    "file_name",
    "song_mxl_base64",
];

const COMPOSITE_UNIQUE_CONSTRAINT = "ui_title_composer_level"; // matches DB name

function isObjectRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null;
}

function isNonEmptyString(v: unknown): v is string {
    return typeof v === "string" && v.length > 0;
}

function missingFields(body: Record<string, unknown>): string[] {
    const missing: string[] = [];
    for (const k of REQUIRED_KEYS) {
        if (!isNonEmptyString(body[k])) {
            missing.push(k);
        }
    }
    return missing;
}

function uniqueViolationFor(
    err: PostgrestError | null,
    constraintFragment: string
): boolean {
    if (!err) {
        return false;
    }
    if (err.code !== "23505") {
        return false;
    }
    if (typeof err.message !== "string") {
        return false;
    }
    return err.message.includes(constraintFragment);
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

export async function POST(req: Request) {
    try {
        const raw = (await req.json()) as unknown;

        if (!isObjectRecord(raw)) {
            return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const missing = missingFields(raw);
        if (missing.length > 0) {
            return NextResponse.json(
                { error: `Missing or invalid: ${missing.join(", ")}` },
                { status: 400 }
            );
        }

        // At this point types are safe to narrow
        const body = raw as SongPayload;

        // Decode base64 → bytes, validate ZIP, then convert to Postgres hex bytea literal (\x...)
        let mxlHex: string;
        try {
            const buf = Buffer.from(body.song_mxl_base64, "base64");
            const u8 = new Uint8Array(buf);

            if (!isZipMagic(u8)) {
                return NextResponse.json(
                    { error: "payload_not_mxl_zip", message: "Song bytes must be compressed .mxl (ZIP) format." },
                    { status: 400 }
                );
            }

            // Build hex form that PostgREST/PG will parse as bytea
            mxlHex = "\\x" + Buffer.from(u8).toString("hex");
        } catch {
            return NextResponse.json(
                { error: "invalid_base64", message: "song_mxl_base64 is not valid base64." },
                { status: 400 }
            );
        }

        // Pass base64 directly into the bytea column; PostgREST will decode.
        const { data, error } = await supabaseAdmin
            .from("song")
            .upsert(
                {
                    song_title: body.song_title,
                    composer_first_name: body.composer_first_name,
                    composer_last_name: body.composer_last_name,
                    skill_level_name: body.skill_level_name,
                    file_name: body.file_name,
                    song_mxl: mxlHex,
                    updated_datetime: new Date().toISOString(),
                },
                { onConflict: "file_name", ignoreDuplicates: false }
            )
            .select("song_id")
            .single();

        if (error) {
            if (uniqueViolationFor(error, COMPOSITE_UNIQUE_CONSTRAINT)) {
                return NextResponse.json(
                    {
                        error: "duplicate_song_metadata",
                        message:
                            "A song with the same Title/Composer/Level already exists.",
                    },
                    { status: 409 }
                );
            }

            // Typical name for the single-column unique on file_name:
            // 'song_file_name_key' (or the message includes 'file_name')
            if (
                uniqueViolationFor(error, "song_file_name_key") ||
                uniqueViolationFor(error, "file_name")
            ) {
                return NextResponse.json(
                    { error: "duplicate_file_name", message: "File name already used." },
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

// ---- GET /api/song  (list songs; sortable) ----
type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
    file_name: string;
    inserted_datetime: string;
    updated_datetime: string;
};

const ALLOWED_SORT: ReadonlyArray<keyof SongListItem> = [
    "song_title",
    "composer_last_name",
    "composer_first_name",
    "skill_level_name",
    "file_name",
    "updated_datetime",
    "inserted_datetime",
] as const;

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);
        const sortParam = (url.searchParams.get("sort") ?? "song_title") as keyof SongListItem;
        const dirParam = (url.searchParams.get("dir") ?? "asc").toLowerCase();
        const limitParam = url.searchParams.get("limit");

        const sort = ALLOWED_SORT.includes(sortParam) ? sortParam : "song_title";
        const ascending = dirParam !== "desc";
        const limit = Math.min(Math.max(Number(limitParam ?? 1000), 1), 2000);
        const rangeEnd = limit - 1;

        const { data, error } = await supabaseAdmin
            .from("song")
            .select(
                "song_id, song_title, composer_first_name, composer_last_name, skill_level_name, file_name, inserted_datetime, updated_datetime"
            )
            .order(sort as string, { ascending })
            .range(0, rangeEnd);

        if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });
        }

        return new Response(JSON.stringify({ items: (data ?? []) as SongListItem[] }), {
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
