// src/app/admin/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import { usePrefersDark, themeTokens } from "@/lib/theme";

export default function AdminHubPage(): React.ReactElement {
    const prefersDark = usePrefersDark();
    const theme = themeTokens(prefersDark);

    return (
        <div className="p-6 space-y-6 min-h-[60vh]" style={{ background: theme.bg, color: theme.fg }}>
            <h1 className="text-2xl font-semibold">Admin</h1>

            <div className="grid gap-4 md:grid-cols-2">
                <Link href="/admin/song" className="no-underline">
                    <div
                        className="rounded-2xl border p-4 hover:shadow-md transition-shadow cursor-pointer"
                        style={{ background: theme.panelBg, borderColor: theme.border }}
                    >
                        <div className="text-lg font-medium">Song Admin</div>
                        <div className="opacity-70 text-sm">
                            Manage songs (list, sort, edit, upload).
                        </div>
                    </div>
                </Link>

                <Link href="/admin/user" className="no-underline">
                    <div
                        className="rounded-2xl border p-4 hover:shadow-md transition-shadow cursor-pointer"
                        style={{ background: theme.panelBg, borderColor: theme.border }}
                    >
                        <div className="text-lg font-medium">User Admin</div>
                        <div className="opacity-70 text-sm">
                            Manage users (list, sort, edit). {/* Association will come later */}
                        </div>
                    </div>
                </Link>
            </div>
        </div>
    );
}
