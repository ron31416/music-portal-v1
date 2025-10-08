// app/api/work/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PostgrestError } from "@supabase/supabase-js";

type WorkPayload = {
    work_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string; // FK → skill_level.skill_level_name
    file_name: string;        // UNIQUE guardrail against double-upload
    work_mxl_base64: string;  // base64-encoded MusicXML/MXL bytes
};

const REQUIRED_KEYS: (keyof WorkPayload)[] = [
    "work_title",
    "composer_first_name",
    "composer_last_name",
    "skill_level_name",
    "file_name",
    "work_mxl_base64",
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
        const body = raw as WorkPayload;

        // Pass base64 directly into the bytea column; PostgREST will decode.
        const { data, error } = await supabaseAdmin
            .from("work")
            .upsert(
                {
                    work_title: body.work_title,
                    composer_first_name: body.composer_first_name,
                    composer_last_name: body.composer_last_name,
                    skill_level: body.skill_level_name,
                    file_name: body.file_name,
                    work_mxl: body.work_mxl_base64,
                    updated_datetime: new Date().toISOString(),
                },
                { onConflict: "file_name", ignoreDuplicates: false }
            )
            .select("work_id")
            .single();

        if (error) {
            if (uniqueViolationFor(error, COMPOSITE_UNIQUE_CONSTRAINT)) {
                return NextResponse.json(
                    {
                        error: "duplicate_work_metadata",
                        message:
                            "A work with the same Title/Composer/Level already exists.",
                    },
                    { status: 409 }
                );
            }

            // Typical name for the single-column unique on file_name:
            // 'work_file_name_key' (or the message includes 'file_name')
            if (
                uniqueViolationFor(error, "work_file_name_key") ||
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

        return NextResponse.json({ ok: true, work_id: data?.work_id }, { status: 200 });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
