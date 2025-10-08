export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function guessMimeFromName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.endsWith(".mxl") || lower.endsWith(".zip")) { return "application/zip"; }
    if (lower.endsWith(".musicxml") || lower.endsWith(".xml")) { return "application/vnd.recordare.musicxml+xml"; }
    return "application/octet-stream";
}

export async function GET(_req: Request, context: { params: { id: string } }) {
    const idNum = Number(context.params.id);
    if (!Number.isFinite(idNum)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
        .from("song")
        .select("file_name, work_mxl") // column names unchanged; table is now "song"
        .eq("work_id", idNum)          // PK column name unchanged
        .single();

    if (error || !data) {
        return NextResponse.json({ error: error?.message ?? "Not found" }, { status: 404 });
    }

    // Supabase/PostgREST returns bytea as base64
    const base64 = data.work_mxl as unknown as string;
    const buf = Buffer.from(base64, "base64");

    const headers = new Headers();
    headers.set("Content-Type", guessMimeFromName(data.file_name));
    headers.set("Content-Disposition", `inline; filename="${data.file_name}"`);

    return new NextResponse(buf, { status: 200, headers });
}
