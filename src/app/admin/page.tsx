// src/app/admin/page.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";

export default function AdminHubPage(): React.ReactElement {
    const router = useRouter();

    function goSongs(): void {
        router.push("/admin/songs");
    }

    return (
        <div className="min-h-screen w-full flex items-center justify-center gap-4">
            <button
                type="button"
                onClick={goSongs}
                className="rounded-xl border px-6 py-3 text-base hover:shadow-sm transition-shadow"
            >
                Songs
            </button>

            <button
                type="button"
                disabled={true}
                aria-disabled="true"
                className="rounded-xl border px-6 py-3 text-base opacity-60 cursor-not-allowed"
                title="Coming soon"
            >
                Users
            </button>
        </div>
    );
}
