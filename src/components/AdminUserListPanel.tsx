// src/components/admin/AdminUserListPanel.tsx
"use client";

import React from "react";
import { USER_COL, type UserColToken } from "@/lib/userCols";
import type { UserListItem } from "@/lib/types";
import SortHeaderButton from "@/components/common/SortHeaderButton";
import type { ThemeTokens } from "@/lib/theme";

type SortDir = "asc" | "desc";

type Props = {
  // Data & status
  rows: ReadonlyArray<UserListItem>;
  listLoading: boolean;
  listError: string;

  // Sorting (server-side only)
  sort: UserColToken | null;
  sortDir: SortDir;
  onToggleSort(col: UserColToken): void;

  // Row selection
  onRowClick(row: UserListItem): void;

  // Layout / theming (kept identical to AdminPage constants)
  gridCols: React.CSSProperties["gridTemplateColumns"];
  tableMinPx: number;
  rowPx: number;
  visibleRowCount: number;
  T: ThemeTokens;
};

export default function AdminUserListPanel(props: Props): React.ReactElement {
  const {
    rows,
    listLoading,
    listError,
    sort,
    sortDir,
    onToggleSort,
    onRowClick,
    gridCols,
    tableMinPx,
    rowPx,
    visibleRowCount,
    T,
  } = props;

  return (
    <section aria-label="Users" style={{ marginTop: 0 }}>
      {listError && (
        <p style={{ color: "#ff6b6b", margin: "4px 0 8px" }}>
          Error: {listError}
        </p>
      )}

      {/* Outer wrapper keeps layout tidy on narrow screens */}
      <div style={{ width: "100%", overflowX: "auto" }}>
        <div
          style={{
            position: "relative",
            width: tableMinPx,
            maxWidth: "100%",
            margin: "0 auto",
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            overflowX: "hidden",
            overflowY: "hidden",
            background: T.bgCard,
          }}
        >
          {listLoading && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(1px)",
                pointerEvents: "none",
              }}
            >
              <p style={{ color: T.headerFg, opacity: 0.85 }}>Loading…</p>
            </div>
          )}

          {/* Header row */}
          <div
            id="users-header"
            style={{
              display: "grid",
              gridTemplateColumns: gridCols,
              width: tableMinPx,
              padding: "8px 10px",
              background: T.headerBg,
              color: T.headerFg,
              borderBottom: `1px solid ${T.border}`,
              fontWeight: 600,
              fontSize: 13,
              opacity: listLoading ? 0.7 : 1,
              transition: "opacity 120ms linear",
            }}
          >
            <SortHeaderButton<UserColToken>
              col={USER_COL.userName}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="User Name"
            />
            <SortHeaderButton<UserColToken>
              col={USER_COL.userEmail}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="Email"
            />
            <SortHeaderButton<UserColToken>
              col={USER_COL.userFirstName}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="User First"
            />
            <SortHeaderButton<UserColToken>
              col={USER_COL.userLastName}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="User Last"
            />
            <SortHeaderButton<UserColToken>
              col={USER_COL.userRoleNumber}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="User Role"
            />
            <SortHeaderButton<UserColToken>
              col={USER_COL.updatedDatetime}
              curSort={sort}
              dir={sortDir}
              onToggle={onToggleSort}
              label="Updated"
            />
          </div>

          {/* Body section */}
          <div
            style={{
              height: rowPx * visibleRowCount,
              overflowY: rows.length > visibleRowCount ? "auto" : "hidden",
              overflowX: "hidden",
              borderTop: `1px solid ${T.border}`,
              opacity: listLoading ? 0.7 : 1,
              transition: "opacity 120ms linear",
            }}
            aria-busy={listLoading}
          >
            {rows.map((r, idx) => {
              const bg = (idx % 2 === 0) ? T.rowEven : T.rowOdd;
              return (
                <div
                  key={r.user_id}
                  onClick={() => { onRowClick(r); }}
                  onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(r);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    display: "grid",
                    gridTemplateColumns: gridCols,
                    width: tableMinPx,
                    padding: "8px 10px",
                    borderBottom: `1px solid ${T.border}`,
                    fontSize: 13,
                    alignItems: "center",
                    cursor: "pointer",
                    background: bg,
                    color: T.rowFg,
                    height: rowPx,
                    lineHeight: `${rowPx - 10}px`,
                  }}
                >
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.user_name || "\u2014"}
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.user_email || "\u2014"}
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.user_first_name || "\u2014"}
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.user_last_name || "\u2014"}
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.user_role_name}
                  </div>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.updated_datetime}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
