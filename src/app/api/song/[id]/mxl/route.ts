// app/api/song/[id]/mxl/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { Buffer } from "node:buffer";

type Row = {
    song_mxl: unknown;
    song_title: string | null;
};

/** Make a brand-new ArrayBuffer (no SharedArrayBuffer union) */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    const out = new Uint8Array(u8.byteLength);
    out.set(u8);
    return out.buffer;
}

/** Normalize Supabase/Postgres bytea-like values to a fresh ArrayBuffer */
function normalizeToArrayBuffer(raw: unknown): ArrayBuffer {
    if (raw === null || raw === undefined) {
        throw new Error("song_mxl is null");
    }

    if (typeof raw === "string") {
        // Most common: "\x..." hex string from Postgres bytea
        if (raw.startsWith("\\x")) {
            const hex = raw.slice(2);
            const u8 = new Uint8Array(Buffer.from(hex, "hex"));
            return toArrayBuffer(u8);
        }
        // Fallback: base64 string
        const u8 = new Uint8Array(Buffer.from(raw, "base64"));
        return toArrayBuffer(u8);
    }

    if (raw instanceof Uint8Array) {
        return toArrayBuffer(raw);
    }

    if (Array.isArray(raw)) {
        return toArrayBuffer(Uint8Array.from(raw));
    }

    throw new Error(`Unsupported song_mxl type: ${typeof raw}`);
}

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> } // ← Next 15 requires Promise here
): Promise<Response> {
    try {
        const { id } = await ctx.params;
        const songId = Number(id);
        if (!Number.isFinite(songId)) {
            return new Response("Bad id", { status: 400 });
        }

        const { data, error } = await supabaseAdmin
            .from("song")
            .select("song_mxl, song_title")
            .eq("song_id", songId)
            .single();

        if (error) {
            return new Response(
                JSON.stringify({ message: error.message }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }
        if (!data) {
            return new Response("Not found", { status: 404 });
        }

        const row = data as Row;
        const ab = normalizeToArrayBuffer(row.song_mxl);
        const title = row.song_title ?? "score";

        // Optional: /api/song/:id/mxl?debug=1
        if (req.nextUrl.searchParams.get("debug")) {
            return new Response(
                JSON.stringify({ ok: true, byteLength: ab.byteLength }),
                { status: 200, headers: { "Content-Type": "application/json" } }
            );
        }

        return new Response(ab, {
            status: 200,
            headers: {
                // .mxl (compressed MusicXML)
                "Content-Type": "application/vnd.recordare.musicxml",
                "Content-Disposition": `inline; filename="${encodeURIComponent(title + ".mxl")}"`,
                "Cache-Control": "no-store",
            },
        });
    } catch (e) {
        const message =
            e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
