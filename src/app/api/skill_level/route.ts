// app/api/skill-levels/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET() {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY! // or anon key if your RLS allows read
    );

    const { data, error } = await supabase
        .from("skill_level")
        .select("skill_level_name")
        .order("skill_level_name");

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const levels = (data ?? []).map(r => r.skill_level_name);
    return NextResponse.json({ levels }, { status: 200 });
}
