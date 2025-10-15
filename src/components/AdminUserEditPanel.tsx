// src/components/AdminUserEditPanel.tsx
"use client";

import React from "react";
import type { UserListItem } from "@/lib/types";

type Props = {
    user: UserListItem | null;
};

export default function AdminUserEditPanel(props: Props): React.ReactElement {
    const { user } = props;

    return (
        <div id="user-edit-card" className="rounded-xl border p-3">
            <div className="text-sm opacity-70 mb-2">User Edit</div>
            {user === null ? (
                <div className="italic opacity-60">Select a user to edit…</div>
            ) : (
                <div className="space-y-2">
                    <div><span className="font-medium">User:</span> {user.user_name}</div>
                    <div><span className="font-medium">Email:</span> {user.user_email}</div>
                    {/* TODO: Replace with real form + save/delete once /api/user is ready */}
                </div>
            )}
        </div>
    );
}
