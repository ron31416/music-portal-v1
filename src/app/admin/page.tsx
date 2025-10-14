// src/app/admin/page.tsx
"use client";

import React from "react";
import Link from "next/link";

export default function AdminHubPage(): React.ReactElement {
    return (
        <div className="min-h-screen flex items-center justify-center gap-4">
            <Link
                href="/admin/song"
                className="rounded-xl border px-6 py-3 text-base no-underline hover:shadow-sm transition-shadow"
            >
                Songs
            </Link>

            <button
                type="button"
                className="rounded-xl border px-6 py-3 text-base opacity-60 cursor-not-allowed"
                disabled={true}
            >
                Users
            </button>
        </div>
    );
}
