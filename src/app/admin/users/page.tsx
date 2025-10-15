// src/app/admin/users/page.tsx
"use client";

import React from "react";

import { usePrefersDark, themeTokens } from "@/lib/theme";
import AdminUserListPanel from "@/components/AdminUserListPanel";
import AdminUserEditPanel from "@/components/AdminUserEditPanel";
import type { UserListItem } from "@/lib/types";
import { type UserColToken, DEFAULT_SORT, DEFAULT_DIR } from "@/lib/userCols";
import { fetchUserList } from "@/lib/userListFetch";


// --- Config ---

//                First  Last   Username  Email   Role   Updated
const GRID_COLS_PX = [50, 50, 100, 100, 100, 50] as const;
const GRID_COLS: React.CSSProperties["gridTemplateColumns"] = GRID_COLS_PX.map(n => `${n}px`).join(" ");
const TABLE_MIN_PX = GRID_COLS_PX.reduce((a, b) => a + b, 0);
const TABLE_ROW_PX = 28;
const TABLE_ROW_COUNT = 10;

const USER_LIST_ENDPOINT = "/api/userlist";


// --- Types ---

type SortDir = "asc" | "desc";

export default function AdminUsersPage(): React.ReactElement {
    // Users list state (inline, always visible)
    const [rows, setRows] = React.useState<UserListItem[]>([]);
    const [listLoading, setListLoading] = React.useState(false);
    const [listError, setListError] = React.useState("");

    // Server sorting only
    const [sort, setSort] = React.useState<UserColToken | null>(DEFAULT_SORT);
    const [sortDir, setSortDir] = React.useState<SortDir>(DEFAULT_DIR);

    // Selection for the edit panel
    const [selected, setSelected] = React.useState<UserListItem | null>(null);

    // Abort/seq guards (match Songs page pattern)
    const listAbortRef = React.useRef<AbortController | null>(null);
    const listSeqRef = React.useRef(0);

    const isDark = usePrefersDark();
    const T = React.useMemo(() => themeTokens(isDark), [isDark]);

    // fetch list on mount
    React.useEffect(() => {
        void refreshUserList();
        return () => {
            if (listAbortRef.current !== null) {
                listAbortRef.current.abort();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refreshUserList(
        overrideSort?: UserColToken | null,
        overrideDir?: SortDir,
        showSpinner: boolean = true
    ): Promise<void> {
        setListError("");
        if (showSpinner) {
            setListLoading(true);
        }

        // cancel any in-flight request
        if (listAbortRef.current !== null) {
            listAbortRef.current.abort();
        }

        // set up new request + sequence
        const controller = new AbortController();
        listAbortRef.current = controller;
        const seq = listSeqRef.current + 1;
        listSeqRef.current = seq;

        try {
            const effSort = overrideSort ?? sort;
            const effDir: SortDir = overrideDir ?? sortDir;

            const data = await fetchUserList(
                USER_LIST_ENDPOINT,
                effSort,      // UserColToken | null → string | null OK (snake_case token)
                effDir,
                controller.signal
            );

            // ignore stale responses
            if (seq !== listSeqRef.current) { return; }

            setRows(data);
        } catch (e: unknown) {
            const name = (e as { name?: string } | null)?.name ?? "";
            if (name === "AbortError") { return; }
            setListError(e instanceof Error ? e.message : String(e));
            setRows([]);
        } finally {
            if (seq === listSeqRef.current) {
                setListLoading(false);
            }
        }
    }

    const toggleSort = (key: UserColToken): void => {
        const nextDir: SortDir = (sort === key)
            ? (sortDir === "asc" ? "desc" : "asc")
            : "asc";
        setSort(key);
        setSortDir(nextDir);
        void refreshUserList(key, nextDir);
    };

    return (
        <main style={{ maxWidth: TABLE_MIN_PX + 32, margin: "24px auto", padding: "0 16px" }}>
            {/* ===== USER LIST (TOP) ===== */}
            <AdminUserListPanel
                rows={rows}
                listLoading={listLoading}
                listError={listError}
                sort={sort}
                sortDir={sortDir}
                onToggleSort={toggleSort}
                onRowClick={(row) => { setSelected(row); }}
                gridCols={GRID_COLS}
                tableMinPx={TABLE_MIN_PX}
                rowPx={TABLE_ROW_PX}
                visibleRowCount={TABLE_ROW_COUNT}
                T={T}
            />

            {/* ===== EDIT PANEL (ALWAYS VISIBLE, BELOW GRID) ===== */}
            <AdminUserEditPanel user={selected} />

            {/* Guardrails / header theming parity, like Songs */}
            <style jsx global>{`
        #users-header {
          background: ${T.headerBg} !important;
          color: ${T.headerFg} !important;
        }
        #users-header button,
        #users-header * {
          color: ${T.headerFg} !important;
        }
      `}</style>
        </main>
    );
}
