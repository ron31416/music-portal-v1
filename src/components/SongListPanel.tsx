// src/components/SongListPanel.tsx
"use client";

import React from "react";
import { SONG_COL, type SongColToken } from "@/lib/songCols";
import type { SongListItem } from "@/lib/types";
import SortHeaderButton from "@/components/common/SortHeaderButton";

type SortDir = "asc" | "desc";

type Props = {
    // Data & status
    rows: ReadonlyArray<SongListItem>;
    listLoading: boolean;
    listError: string;

    // Sorting (server-side only)
    sort: SongColToken | null;
    sortDir: SortDir;
    onToggleSort(col: SongColToken): void;

    // Row interaction
    onRowClick(row: SongListItem): void;

    // Layout / theming
    gridCols: React.CSSProperties["gridTemplateColumns"]; // e.g., "170px 170px 380px 90px"
    tableMinPx: number;                                    // sum of column widths
    rowPx: number;                                         // e.g., 28
    visibleRowCount: number;                               // e.g., 25
    T: Readonly<Record<string, string | number>>;
};

export default function SongListPanel(props: Props): React.ReactElement {
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

    const bodyPx = rowPx * visibleRowCount;

    return (
        <section aria-label="Songs" style={{ marginTop: 0 }}>
            {/* Inline status line, but keep the table mounted */}
            {listError && (
                <p style={{ color: "#ff6b6b", margin: "4px 0 8px" }}>
                    Error: {listError}
                </p>
            )}

            {/* Outer safety wrapper: keeps layout tidy on narrow screens */}
            <div style={{ width: "100%", overflowX: "auto" }}>
                <div
                    style={{
                        position: "relative",
                        width: tableMinPx,            // match the grid width
                        maxWidth: "100%",             // don’t exceed viewport
                        margin: "0 auto",             // center the card
                        border: `1px solid ${T.border}`,
                        borderRadius: 6,
                        overflowX: "hidden",
                        overflowY: "hidden",
                        background: T.bgCard as string,
                    }}
                >
                    {/* Loader overlay that does not collapse layout */}
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
                            <p style={{ color: T.headerFg as string, opacity: 0.85 }}>Loading…</p>
                        </div>
                    )}

                    {/* Header */}
                    <div
                        id="songs-header"
                        style={{
                            display: "grid",
                            gridTemplateColumns: gridCols,
                            width: tableMinPx,
                            padding: "8px 10px",
                            background: T.headerBg as string,
                            color: T.headerFg as string,
                            borderBottom: `1px solid ${T.border}`,
                            fontWeight: 600,
                            fontSize: 13,
                            opacity: listLoading ? 0.7 : 1,
                            transition: "opacity 120ms linear",
                        }}
                    >
                        <SortHeaderButton<SongColToken>
                            col={SONG_COL.composerLastName}
                            curSort={sort}
                            dir={sortDir}
                            onToggle={onToggleSort}
                            label="Composer Last Name"
                        />
                        <SortHeaderButton<SongColToken>
                            col={SONG_COL.composerFirstName}
                            curSort={sort}
                            dir={sortDir}
                            onToggle={onToggleSort}
                            label="Composer First Name"
                        />
                        <SortHeaderButton<SongColToken>
                            col={SONG_COL.songTitle}
                            curSort={sort}
                            dir={sortDir}
                            onToggle={onToggleSort}
                            label="Song Title"
                        />
                        <SortHeaderButton<SongColToken>
                            col={SONG_COL.skillLevelNumber}
                            curSort={sort}
                            dir={sortDir}
                            onToggle={onToggleSort}
                            label="Skill Level"
                        />
                    </div>

                    {/* Body: fixed height, scrollbar only when needed */}
                    <div
                        style={{
                            height: bodyPx,
                            overflowY: rows.length > visibleRowCount ? "auto" : "hidden",
                            overflowX: "hidden",
                            borderTop: `1px solid ${T.border}`,
                            opacity: listLoading ? 0.7 : 1,
                            transition: "opacity 120ms linear",
                        }}
                        aria-busy={listLoading}
                    >
                        {/* Data rows */}
                        {rows.map((r, idx) => {
                            const bg = idx % 2 === 0 ? (T.rowEven as string) : (T.rowOdd as string);
                            return (
                                <div
                                    key={r.song_id}
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
                                        color: T.rowFg as string,
                                        height: rowPx,
                                        lineHeight: `${rowPx - 10}px`,
                                    }}
                                    title="Open in a new tab"
                                >
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.composer_last_name || "\u2014"}
                                    </div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.composer_first_name || "\u2014"}
                                    </div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.song_title}
                                    </div>
                                    <div>{r.skill_level_name}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
}
