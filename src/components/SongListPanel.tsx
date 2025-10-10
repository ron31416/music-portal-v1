// src/components/SongListPanel.tsx
"use client";

import React from "react";
import { SONG_COL, type SongColToken } from "@/lib/songCols";

const ROW_PX = 28;
const ROW_COUNT = 20;
const TABLE_BODY_PX = ROW_PX * ROW_COUNT

// Composer Last | Composer First | Song Title | Skill Level
const GRID_COLS = "1.2fr 1.2fr 2fr 1fr" as const;

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

type SortDir = "asc" | "desc";

function HeaderButton(props: {
    label: string;
    token: SongColToken;
    curToken: SongColToken | null;
    dir: SortDir;
    onClick: (token: SongColToken) => void;
}) {
    const active = props.curToken === props.token;
    const caret = active ? (props.dir === "asc" ? "▲" : "▼") : "";
    return (
        <button
            type="button"
            onClick={() => { props.onClick(props.token); }}
            title={`Sort by ${props.label}`}
            style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 13,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "#111",
            }}
        >
            {props.label} {caret}
        </button>
    );
}

export default function SongListPanel(): React.ReactElement {
    const [rows, setRows] = React.useState<SongListItem[]>([]);
    const [sortToken, setSortToken] = React.useState<SongColToken | null>(SONG_COL.composerLastName);
    const [sortDir, setSortDir] = React.useState<SortDir>("asc");

    const fetchList = React.useCallback(async (token: SongColToken | null, dir: SortDir) => {
        try {
            const params = new URLSearchParams();
            params.set("limit", "1000");
            if (token !== null) {
                params.set("sort", token);
                params.set("dir", dir);
            }
            const res = await fetch(`/api/songlist?${params.toString()}`, { cache: "no-store" });
            if (!res.ok) {
                return;
            }
            const json: { items?: SongListItem[] } = await res.json();
            setRows(Array.isArray(json.items) ? json.items : []);
        } catch {
            // intentionally silent (no status UI)
        }
    }, []);

    React.useEffect(() => {
        void fetchList(sortToken, sortDir);
    }, [fetchList, sortToken, sortDir]);

    const toggleSort = (token: SongColToken): void => { // ← was (token: string)
        const same = sortToken === token;
        const newDir: SortDir = same ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        setSortToken(token);   // ✅ now matches SongColToken | null
        setSortDir(newDir);
    };


    const openInNewTab = (id: number): void => {
        // Avoid encoding the path; pass raw so the viewer fetches the correct URL.
        const tabId = Date.now().toString(36);
        const url = `/viewer?tab=${tabId}&src=/api/song/${id}/mxl`;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            <section
                aria-labelledby="song-list-h"
                style={{
                    width: "min(760px, 92vw)",
                    border: "1px solid #e5e5e5",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "transparent",
                    color: "#111",
                    marginBottom: 24,
                    alignSelf: "flex-start",
                    height: ROW_PX + TABLE_BODY_PX,
                    display: "flex",
                    flexDirection: "column",
                }}
            >                <h3
                id="song-list-h"
                style={{
                    position: "absolute",
                    width: 1,
                    height: 1,
                    padding: 0,
                    margin: -1,
                    overflow: "hidden",
                    clip: "rect(0 0 0 0)",
                    whiteSpace: "nowrap",
                    border: 0,
                }}
            >
                    Song List
                </h3>

                {/* Header with server-backed sorting */}
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: GRID_COLS,
                        height: ROW_PX,
                        lineHeight: `${ROW_PX}px`,     // ← match row line-height
                        padding: "0 10px",             // ← match row horizontal padding
                        background: "#f3f3f3",
                        borderBottom: "1px solid #ddd",
                        boxSizing: "border-box",
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#111",
                        letterSpacing: 0.2,
                        alignItems: "center",          // ok to keep; ensures non-text children center too
                    }}
                >
                    <HeaderButton label="Composer Last" token={SONG_COL.composerLastName} curToken={sortToken} dir={sortDir} onClick={toggleSort} />
                    <HeaderButton label="Composer First" token={SONG_COL.composerFirstName} curToken={sortToken} dir={sortDir} onClick={toggleSort} />
                    <HeaderButton label="Song Title" token={SONG_COL.songTitle} curToken={sortToken} dir={sortDir} onClick={toggleSort} />
                    <HeaderButton label="Skill Level" token={SONG_COL.skillLevelNumber} curToken={sortToken} dir={sortDir} onClick={toggleSort} />
                </div>

                {/* Fixed-height scroll area (10 inches ~= 960px) */}
                <div style={{ height: TABLE_BODY_PX, overflow: "auto", background: "#fff" }}>
                    {rows.map((r) => {
                        return (
                            <div
                                key={r.song_id}
                                onClick={() => { openInNewTab(r.song_id); }}
                                onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        openInNewTab(r.song_id);
                                    }
                                }}
                                role="link"
                                tabIndex={0}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: GRID_COLS,
                                    height: ROW_PX,
                                    padding: "0 10px",
                                    borderBottom: "1px solid #f0f0f0",
                                    fontSize: 13,
                                    alignItems: "center",
                                    boxSizing: "border-box",
                                    cursor: "pointer",
                                    background: "#fff",
                                    color: "#111",
                                }}
                                title="Open in a new tab"
                            >
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {r.composer_last_name}
                                </div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {r.composer_first_name}
                                </div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {r.song_title}
                                </div>
                                <div>
                                    {r.skill_level_name}
                                </div>
                            </div>
                        );
                    })}

                    {/* Filler rows to show empty grid lines up to the fixed height */}
                    {(() => {
                        const rowsPerView = Math.floor(TABLE_BODY_PX / ROW_PX);
                        const fillerCount = Math.max(0, rowsPerView - rows.length);
                        const fillers: React.ReactElement[] = [];
                        for (let i = 0; i < fillerCount; i++) {
                            fillers.push(
                                <div
                                    key={`filler-${i}`}
                                    aria-hidden="true"
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: GRID_COLS,
                                        height: ROW_PX,              // fixed row height
                                        padding: "0 10px",           // no vertical padding
                                        borderBottom: "1px solid #f0f0f0",
                                        fontSize: 13,
                                        alignItems: "center",
                                        boxSizing: "border-box",
                                        background: "#fff",
                                        color: "transparent",
                                        userSelect: "none",
                                    }}
                                >
                                    <div> </div>
                                    <div> </div>
                                    <div> </div>
                                    <div> </div>
                                </div>
                            );
                        }
                        return fillers;
                    })()}
                </div>
            </section>
        </div>
    );
}
