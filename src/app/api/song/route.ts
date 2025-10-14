// src/app/api/song/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { SONG_COL } from "@/lib/songCols";
import { Buffer } from "node:buffer";
import { z } from "zod";

/* =========================
   Response helpers / types
   ========================= */

type OkResponse = { ok: true; song_id: number | null };
type ErrResponse = { ok: false; error: string; message?: string };

function ok(body: OkResponse, status = 200): NextResponse<OkResponse> {
    return NextResponse.json<OkResponse>(body, { status });
}
function err(message: string, status = 400, extra?: { message?: string }): NextResponse<ErrResponse> {
    return NextResponse.json<ErrResponse>({ ok: false, error: message, ...(extra ?? {}) }, { status });
}

/* =========================
   Validation
   - We read incoming fields via SONG_COL keys,
     then validate a canonical object with Zod.
   ========================= */

const CanonicalSaveSchema = z.object({
    song_id: z.number().int().positive().optional(),
    song_title: z.string().trim().min(1, "song_title is required"),
    composer_first_name: z.string().trim().min(1, "composer_first_name is required"),
    composer_last_name: z.string().trim().min(1, "composer_last_name is required"),
    // Your DB function expects a NUMBER, not a name:
    skill_level_number: z.number().int().positive({ message: "skill_level_number must be a positive integer" }),
    file_name: z.string().trim().min(1, "file_name is required"),
    // Base64 of the .mxl zip; required on create, optional on pure metadata update.
    mxl_base64: z.string().trim().min(1, "mxl_base64 is required"),
});

type CanonicalSaveInput = z.infer<typeof CanonicalSaveSchema>;

/* =========================
   Small guards
   ========================= */

function isObjectRecord(x: unknown): x is Record<string, unknown> {
    return typeof x === "object" && x !== null;
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
function base64ToByteaHex(b64: string): string {
    const norm = b64.replace(/\s+/g, "");
    const u8 = new Uint8Array(Buffer.from(norm, "base64"));
    if (!isZipMagic(u8)) {
        throw new Error("payload_not_mxl_zip");
    }
    return "\\x" + Buffer.from(u8).toString("hex");
}

/* =========================
   POST /api/song  (create/update a song)
   Uses your RPC: song_upsert(p_*), returns integer song_id
   ========================= */

export async function POST(req: Request): Promise<NextResponse<OkResponse | ErrResponse>> {
    try {
        const raw = (await req.json()) as unknown;
        if (!isObjectRecord(raw)) {
            return err("Invalid JSON body", 400);
        }

        // Map from your column constants to a canonical object we can validate.
        const candidate: CanonicalSaveInput = {
            song_id: (() => {
                const v = raw[SONG_COL.songId];
                if (typeof v === "number" && Number.isInteger(v) && v > 0) { return v; }
                if (typeof v === "string" && /^\d+$/.test(v)) {
                    const n = Number(v);
                    if (Number.isInteger(n) && n > 0) { return n; }
                }
                return undefined;
            })(),
            song_title: String(raw[SONG_COL.songTitle] ?? ""),
            composer_first_name: String(raw[SONG_COL.composerFirstName] ?? ""),
            composer_last_name: String(raw[SONG_COL.composerLastName] ?? ""),
            // DB expects NUMBER, not name:
            skill_level_number: Number(raw[SONG_COL.skillLevelNumber]),
            file_name: String(raw[SONG_COL.fileName] ?? ""),
            mxl_base64: String(raw[SONG_COL.songMxl] ?? ""),
        };

        const parsed = CanonicalSaveSchema.safeParse(candidate);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            return err(first?.message ?? "Invalid request body", 400);
        }
        const input = parsed.data;

        // Convert base64 to Postgres bytea hex literal
        let mxlHex: string | null = null;
        try {
            mxlHex = base64ToByteaHex(input.mxl_base64);
        } catch (e) {
            if (e instanceof Error && e.message === "payload_not_mxl_zip") {
                return err("payload_not_mxl_zip", 400, { message: "Song bytes must be compressed .mxl (ZIP) format." });
            }
            return err("invalid_base64", 400, { message: "mxl_base64 is not valid base64." });
        }

        // RPC to your actual function + argument names
        const { data, error } = await supabaseAdmin.rpc("song_upsert", {
            p_song_id: input.song_id ?? null,
            p_song_title: input.song_title,
            p_composer_first_name: input.composer_first_name,
            p_composer_last_name: input.composer_last_name,
            p_skill_level_number: input.skill_level_number,
            p_file_name: input.file_name,
            p_song_mxl: mxlHex, // bytea hex literal
        });

        if (error) {
            if (error.code === "23505") {
                return err("conflict", 409, { message: "A song with the same file name or (title, composer, level) already exists." });
            }
            if (error.code === "P0002") {
                return err("not_found", 404, { message: "song_id not found for update." });
            }
            return err(error.message ?? "RPC song_upsert failed", 500);
        }

        const songId = typeof data === "number" ? data : null;
        return ok({ ok: true, song_id: songId }, 200);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg, 500);
    }
}

/* =========================
   GET /api/song  (list songs; DB decides columns/order)
   (Kept as-is; standardize later if you want)
   ========================= */

export async function GET(req: NextRequest): Promise<Response> {
    try {
        const url = new URL(req.url);

        const sort = url.searchParams.get("sort") ?? null;
        const dirRaw = (url.searchParams.get("dir") ?? "").toLowerCase();
        const dir = dirRaw === "desc" ? "desc" : "asc";

        const limitParam = url.searchParams.get("limit");
        const limitNum = Number(limitParam);
        const limit = Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), 2000) : 1000;

        const offsetParam = url.searchParams.get("offset");
        const offsetNum = Number(offsetParam);
        const offset = Number.isFinite(offsetNum) ? Math.max(offsetNum, 0) : 0;

        const { data, error } = await supabaseAdmin.rpc("song_list", {
            p_sort_column: sort ?? undefined,
            p_sort_direction: dir,
            //p_limit: limit,
            //p_offset: offset,
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

/* =========================
   DELETE /api/song?id=<song_id>
   Hard-delete via RPC: song_delete(p_song_id)
   ========================= */

export async function DELETE(req: NextRequest): Promise<NextResponse<OkResponse | ErrResponse>> {
    try {
        const url = new URL(req.url);
        const idRaw = url.searchParams.get("id");
        if (!idRaw) {
            return err("missing_id", 400, { message: "Provide ?id=<song_id> in the query string." });
        }

        const idNum = Number(idRaw);
        if (!Number.isInteger(idNum) || idNum <= 0) {
            return err("invalid_id", 400, { message: "song_id must be a positive integer." });
        }

        const { data, error } = await supabaseAdmin.rpc("song_delete", {
            p_song_id: idNum,
        });

        if (error) {
            // If you don't have ON DELETE CASCADE on child tables, FK violations may surface as 23503
            if (error.code === "23503") {
                return err("constraint_violation", 409, {
                    message: "Cannot delete: this song is referenced by other records.",
                });
            }
            return err(error.message ?? "RPC song_delete failed", 500);
        }

        const deletedCount = typeof data === "number" ? data : Number(data ?? 0);
        if (deletedCount < 1) {
            return err("not_found", 404, { message: "song_id not found." });
        }

        return ok({ ok: true, song_id: idNum }, 200);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return err(msg, 500);
    }
}
