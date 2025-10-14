"use client";

import React from "react";
import type { UserListItem } from "@/lib/types";
import { USER_COL_LABEL, type UserColToken, colToServerKey } from "@/lib/userCols";
import { themeTokens } from "@/lib/theme";

type SortDir = "asc" | "desc";

type Props = {
  rows: UserListItem[];
  listLoading: boolean;
  listError: string;
  sort: UserColToken | null;
  sortDir: SortDir;
  onToggleSort: (key: UserColToken) => void;
  onRowClick: (row: UserListItem) => void;

  // layout/theming (match AdminSongListPanel props)
  gridCols: React.CSSProperties["gridTemplateColumns"];
  tableMinPx: number;
  rowPx: number;
  visibleRowCount: number;
  T: ReturnType<typeof themeTokens>;
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

  // Columns to display in order — adjust to your taste/widths provided by parent
  const columns: UserColToken[] = [
    "userFirstName",
    "userLastName",
    "userName",
    "userEmail",
    "userRoleId",
  ];

  const arrow = (k: UserColToken): string =>
    sort === k ? (sortDir === "asc" ? "▲" : "▼") : "";

  const headerButton = (k: UserColToken) => (
    <button
      key={k}
      type="button"
      onClick={() => onToggleSort(k)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: "transparent",
        border: "none",
        padding: 0,
        margin: 0,
        fontWeight: 600,
        cursor: "pointer",
      }}
      title={`Sort by ${USER_COL_LABEL[k]} (${colToServerKey(k)})`}
    >
      <span>{USER_COL_LABEL[k]}</span>
      <span aria-hidden="true" style={{ opacity: sort === k ? 1 : 0.3 }}>
        {arrow(k)}
      </span>
    </button>
  );

  return (
    <section aria-label="Users list">
      {/* Header */}
      <div
        id="users-header"
        style={{
          minWidth: tableMinPx,
          display: "grid",
          gridTemplateColumns: gridCols,
          background: T.headerBg as string,
          color: T.headerFg as string,
          padding: "8px 10px",
          border: `1px solid ${T.border}`,
          borderRadius: "8px 8px 0 0",
        }}
      >
        {columns.map((k) => (
          <div key={k} style={{ display: "flex", alignItems: "center" }}>
            {headerButton(k)}
          </div>
        ))}
      </div>

      {/* Body */}
      <div
        style={{
          minWidth: tableMinPx,
          maxHeight: visibleRowCount * rowPx,
          overflow: "auto",
          borderLeft: `1px solid ${T.border}`,
          borderRight: `1px solid ${T.border}`,
          borderBottom: `1px solid ${T.border}`,
          borderRadius: "0 0 8px 8px",
          background: T.bgCard as string,
          color: T.fgCard as string,
        }}
      >
        {listError && (
          <div
            role="alert"
            style={{
              padding: "12px",
              color: "#ff6b6b",
              borderBottom: `1px solid ${T.border}`,
            }}
          >
            {listError}
          </div>
        )}

        {listLoading && rows.length === 0 ? (
          <div style={{ padding: "12px", opacity: 0.8 }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: "12px", opacity: 0.8 }}>No users found.</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.user_id}
              onClick={() => onRowClick(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRowClick(r);
                }
              }}
              style={{
                display: "grid",
                gridTemplateColumns: gridCols,
                height: rowPx,
                alignItems: "center",
                padding: "0 10px",
                borderBottom: `1px solid ${T.border}`,
                cursor: "pointer",
              }}
            >
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.user_first_name}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.user_last_name}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.user_name}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.user_email}
              </div>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {String(r.user_role_id)}
              </div>
            </div>
          ))
        )}

        {listLoading && rows.length > 0 && (
          <div style={{ padding: "8px 10px", opacity: 0.7 }}>Refreshing…</div>
        )}
      </div>
    </section>
  );
}
