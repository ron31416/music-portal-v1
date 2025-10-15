// src/app/admin/users/page.tsx
"use client";

import React from "react";

import { usePrefersDark, themeTokens, fieldStyle } from "@/lib/theme";
import AdminUserListPanel from "@/components/AdminUserListPanel";
import AdminUserEditPanel from "@/components/AdminUserEditPanel";
import type { UserListItem } from "@/lib/types";
import { type UserColToken, DEFAULT_SORT, DEFAULT_DIR, USER_COL } from "@/lib/userCols";
import { fetchUserList } from "@/lib/userListFetch";


// --- Config ---

//                 First Last Username Email Role Updated
const GRID_COLS_PX = [100, 150, 150, 150, 100, 170] as const;
const GRID_COLS: React.CSSProperties["gridTemplateColumns"] = GRID_COLS_PX.map(n => `${n}px`).join(" ");
const TABLE_MIN_PX = GRID_COLS_PX.reduce((a, b) => a + b, 0);
const TABLE_ROW_PX = 28;
const TABLE_ROW_COUNT = 10;

const USER_LIST_ENDPOINT = "/api/userlist";
const ROLE_LIST_ENDPOINT = "/api/user-role";
const SAVE_ENDPOINT = "/api/user";

// --- Types ---
type SortDir = "asc" | "desc";
type Role = { number: number; name: string };
type SaveResponse = { user_id?: number; message?: string; error?: string };

// --- Type guards ---
function isRole(x: unknown): x is Role {
    if (typeof x !== "object" || x === null) { return false; }
    const r = x as Record<string, unknown>;
    if (typeof r.number !== "number" || !Number.isFinite(r.number)) { return false; }
    if (typeof r.name !== "string") { return false; }
    return true;
}

export default function AdminUsersPage(): React.ReactElement {
    const isDark = usePrefersDark();
    const T = React.useMemo(() => themeTokens(isDark), [isDark]);
    const fieldCss = React.useMemo(() => fieldStyle(isDark), [isDark]);

    // ---- List state (top grid) ----
    const [rows, setRows] = React.useState<UserListItem[]>([]);
    const [listLoading, setListLoading] = React.useState(false);
    const [listError, setListError] = React.useState("");

    const [sort, setSort] = React.useState<UserColToken | null>(DEFAULT_SORT);
    const [sortDir, setSortDir] = React.useState<SortDir>(DEFAULT_DIR);

    const listAbortRef = React.useRef<AbortController | null>(null);
    const listSeqRef = React.useRef(0);

    // ---- Edit state (bottom card) ----
    const [userId, setUserId] = React.useState<number | null>(null);
    const [userName, setUserName] = React.useState("");
    const [userEmail, setUserEmail] = React.useState("");
    const [userFirst, setUserFirst] = React.useState("");
    const [userLast, setUserLast] = React.useState("");
    const [roleNumber, setRoleNumber] = React.useState(""); // selected user_role_number as string

    const [roles, setRoles] = React.useState<Role[]>([]);
    const [rolesLoading, setRolesLoading] = React.useState(false);
    const [rolesError, setRolesError] = React.useState("");

    const [errorText, setErrorText] = React.useState("");
    const [saveOkText, setSaveOkText] = React.useState("");
    const [deleting, setDeleting] = React.useState(false);
    const [statusTick, setStatusTick] = React.useState(0);

    // ---- Effects: load roles once ----
    React.useEffect(() => {
        let cancelled = false;

        async function loadRoles(): Promise<void> {
            try {
                setRolesLoading(true);
                setRolesError("");
                const res = await fetch(ROLE_LIST_ENDPOINT, { cache: "no-store" });
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const json = (await res.json()) as unknown;
                const rolesVal = (json && typeof json === "object" ? (json as Record<string, unknown>).roles : null) as unknown;
                const out: Role[] = [];
                if (Array.isArray(rolesVal)) {
                    for (const it of rolesVal) {
                        if (isRole(it)) { out.push(it); }
                    }
                }
                if (!cancelled) { setRoles(out); }
            } catch (e) {
                if (!cancelled) {
                    setRolesError(e instanceof Error ? e.message : String(e));
                    setRoles([]);
                }
            } finally {
                if (!cancelled) { setRolesLoading(false); }
            }
        }

        void loadRoles();
        return () => { cancelled = true; };
    }, []);

    // ---- Effects: fetch list on mount ----
    React.useEffect(() => {
        void refreshUserList();
        return () => {
            if (listAbortRef.current !== null) { listAbortRef.current.abort(); }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refreshUserList(
        overrideSort?: UserColToken | null,
        overrideDir?: SortDir,
        showSpinner: boolean = true
    ): Promise<void> {
        setListError("");
        if (showSpinner) { setListLoading(true); }

        if (listAbortRef.current !== null) { listAbortRef.current.abort(); }

        const controller = new AbortController();
        listAbortRef.current = controller;
        const seq = listSeqRef.current + 1;
        listSeqRef.current = seq;

        try {
            const effSort = overrideSort ?? sort;
            const effDir: SortDir = overrideDir ?? sortDir;

            const data = await fetchUserList(
                USER_LIST_ENDPOINT,
                effSort,   // snake_case token
                effDir,
                controller.signal
            );

            if (seq !== listSeqRef.current) { return; }
            setRows(data);
        } catch (e) {
            const name = (e as { name?: string } | null)?.name ?? "";
            if (name === "AbortError") { return; }
            setListError(e instanceof Error ? e.message : String(e));
            setRows([]);
        } finally {
            if (seq === listSeqRef.current) { setListLoading(false); }
        }
    }

    const toggleSort = (key: UserColToken): void => {
        const nextDir: SortDir = (sort === key) ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        setSort(key);
        setSortDir(nextDir);
        void refreshUserList(key, nextDir);
    };

    // ---- Selecting a row fills the form (matches Songs' loadSongRow shape) ----
    async function loadUserRow(item: UserListItem): Promise<void> {
        setErrorText("");
        setSaveOkText("");

        setUserId(item.user_id);
        setUserName(item.user_name ?? "");
        setUserEmail(item.user_email ?? "");
        setUserFirst(item.user_first_name ?? "");
        setUserLast(item.user_last_name ?? "");
        setRoleNumber(item.user_role_number !== null ? String(item.user_role_number) : "");
    }

    // ---- Save / Delete ----
    const canSave =
        userName.trim().length > 0 &&
        userEmail.trim().length > 0 &&
        roleNumber.length > 0 &&
        !deleting;

    const saveLabel = userId === null ? "Add User" : "Update User";

    async function onSave(): Promise<void> {
        try {
            setErrorText("");
            setSaveOkText("");

            const nameTrim = userName.trim();
            const emailTrim = userEmail.trim();
            const firstTrim = userFirst.trim();
            const lastTrim = userLast.trim();

            if (nameTrim.length === 0) { setErrorText("Username is required."); return; }
            if (emailTrim.length === 0) { setErrorText("Email is required."); return; }
            if (roleNumber.length === 0) { setErrorText("Role is required."); return; }

            const payload = {
                [USER_COL.userId]: userId,
                [USER_COL.userName]: nameTrim,
                [USER_COL.userEmail]: emailTrim,
                [USER_COL.userFirstName]: firstTrim,
                [USER_COL.userLastName]: lastTrim,
                [USER_COL.userRoleNumber]: Number(roleNumber),
            };

            const res = await fetch(SAVE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const ct = res.headers.get("content-type") ?? "";
            let json: SaveResponse | null = null;
            if (ct.includes("application/json")) {
                json = (await res.json()) as unknown as SaveResponse;
            }

            if (!res.ok) {
                const msg = (json?.message || json?.error) ?? `Save failed (HTTP ${res.status})`;
                setErrorText(msg);
                return;
            }

            const newId = (typeof json?.user_id === "number" && Number.isFinite(json.user_id)) ? json.user_id : userId;
            setUserId(newId ?? null);

            await refreshUserList(undefined, undefined, false);
            setSaveOkText(userId === null ? "Added" : "Updated");
            setStatusTick(t => t + 1);
        } catch (e) {
            setErrorText(e instanceof Error ? e.message : String(e));
        }
    }

    async function onDelete(): Promise<void> {
        if (userId === null) { setErrorText("No user selected."); return; }
        const confirmed = window.confirm("Delete this user? This cannot be undone.");
        if (!confirmed) { return; }

        try {
            setDeleting(true);
            setErrorText("");
            setSaveOkText("");

            const res = await fetch(`/api/user?id=${userId}`, { method: "DELETE" });
            if (!res.ok) {
                const ct = res.headers.get("content-type") ?? "";
                let detail = `HTTP ${res.status}`;

                if (ct.includes("application/json")) {
                    try {
                        const j = (await res.json()) as unknown;
                        const msg = (j && typeof j === "object" ? (j as Record<string, unknown>).message : "") as unknown;
                        if (typeof msg === "string" && msg.trim().length > 0) { detail = msg; }
                    } catch {
                        // ignore JSON parse error
                    }
                } else if (ct.startsWith("text/")) {
                    try {
                        const t = await res.text();
                        if (t) { detail = t.slice(0, 200); }
                    } catch {
                        // ignore text read error
                    }
                }

                setErrorText(detail || "Delete failed.");
                return;
            }

            setUserId(null);
            setUserName("");
            setUserEmail("");
            setUserFirst("");
            setUserLast("");
            setRoleNumber("");

            await refreshUserList(undefined, undefined, false);
            setSaveOkText("Deleted");
            setStatusTick(t => t + 1);
        } catch (e) {
            setErrorText(e instanceof Error ? e.message : String(e));
        } finally {
            setDeleting(false);
        }
    }

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
                onRowClick={(row) => { void loadUserRow(row); }}
                gridCols={GRID_COLS}
                tableMinPx={TABLE_MIN_PX}
                rowPx={TABLE_ROW_PX}
                visibleRowCount={TABLE_ROW_COUNT}
                T={T}
            />

            {/* ===== EDIT PANEL (ALWAYS VISIBLE, BELOW GRID) ===== */}
            <AdminUserEditPanel
                userName={userName}
                userEmail={userEmail}
                userFirst={userFirst}
                userLast={userLast}
                roleNumber={roleNumber}
                roles={roles}
                rolesLoading={rolesLoading}
                rolesError={rolesError}
                errorText={listError.length > 0 ? listError : errorText}
                saveOkText={saveOkText}
                statusTick={statusTick}
                canSave={canSave}
                saveLabel={saveLabel}
                canDelete={userId !== null && !deleting}
                deleting={deleting}
                onChangeUserName={setUserName}
                onChangeUserEmail={setUserEmail}
                onChangeUserFirst={setUserFirst}
                onChangeUserLast={setUserLast}
                onChangeRoleNumber={setRoleNumber}
                onSave={onSave}
                onDelete={onDelete}
                T={T}
                fieldCss={fieldCss}
                isDark={isDark}
            />

            {/* Scoped guardrails (mirror Songs) */}
            <style jsx global>{`
        /* Edit card: win even against global .card {...}!important */
        #edit-card {
          background: ${T.bgCard} !important;
          color: ${T.fgCard} !important;
          border: 1px solid ${T.border} !important;
          border-radius: 8px !important;
          padding: 16px !important;
        }

        /* Inputs inside the edit card stay readable in dark mode */
        #edit-card input,
        #edit-card select,
        #edit-card textarea {
          background: ${isDark ? "#121212" : "#ffffff"} !important;
          color: ${isDark ? "#ffffff" : "#111111"} !important;
          border: 1px solid ${T.border} !important;
        }

        /* ---- Users table header (ensure dark bg/fg) ---- */
        #users-header {
          background: ${T.headerBg} !important;
          color: ${T.headerFg} !important;
        }

        /* Ensure header buttons/text use header fg color */
        #users-header button,
        #users-header * {
          color: ${T.headerFg} !important;
        }

        /* Fill the empty part of the table body (below the last row) */
        #users-header + div {
          background: ${T.rowOdd} !important;
        }
      `}</style>
        </main>
    );
}
