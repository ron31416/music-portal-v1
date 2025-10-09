"use client";

import React from "react";

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

type SortKey = "song_title" | "composer" | "skill_level_name";
type SortDir = "asc" | "desc";

function HeaderButton(props: {
    label: string;
    sortKey: SortKey;
    curKey: SortKey;
    dir: SortDir;
    onClick: (k: SortKey) => void;
}) {
    const active = props.curKey === props.sortKey;
    const caret = active ? (props.dir === "asc" ? "▲" : "▼") : "";
    return (
        <button
            type="button"
            onClick={() => { props.onClick(props.sortKey); }}
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
    const [sortKey, setSortKey] = React.useState<SortKey>("composer");
    const [sortDir, setSortDir] = React.useState<SortDir>("asc");

    const fetchList = React.useCallback(async (key: SortKey, dir: SortDir): Promise<void> => {
        try {
            const res = await fetch(
                `/api/songlist?sort=${encodeURIComponent(key)}&dir=${encodeURIComponent(dir)}&limit=1000`,
                { cache: "no-store" }
            );
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
        void fetchList(sortKey, sortDir);
    }, [fetchList, sortKey, sortDir]);

    const toggleSort = (key: SortKey): void => {
        setSortKey(prev => {
            if (prev === key) {
                return prev;
            } else {
                return key;
            }
        });
        setSortDir(prev => {
            if (sortKey === key) {
                return prev === "asc" ? "desc" : "asc";
            } else {
                return "asc";
            }
        });
    };

    const openInNewTab = (id: number): void => {
        const url = `/viewer?src=${encodeURIComponent(`/api/song/${id}/mxl`)}`;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        // OUTER wrapper: centers the white card; avoids full-width white bar
        <div style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            {/* CARD: fixed width and fixed-height scroll area (~10 inches tall) */}
            <section
                aria-labelledby="song-list-h"
                style={{
                    width: "min(660px, 90vw)",
                    border: "1px solid #e5e5e5",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "transparent",   // keep only header+scroller visible
                    color: "#111",
                    marginBottom: 24,
                    alignSelf: "flex-start",      // opt-out of vertical stretching
                }}
            >
                <h3
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
                        gridTemplateColumns: "1.6fr 2fr 1fr", // Composer | Title | Level
                        padding: "8px 10px",
                        background: "#fafafa",
                        borderBottom: "1px solid #e5e5e5",
                        fontWeight: 600,
                        fontSize: 13,
                        color: "#111",
                    }}
                >
                    <HeaderButton label="Composer" sortKey="composer" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <HeaderButton label="Title" sortKey="song_title" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                    <HeaderButton label="Level" sortKey="skill_level_name" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                </div>

                {/* Fixed-height scroll area (10 inches ~= 960px) */}
                <div style={{ height: 960, overflow: "auto", background: "#fff" }}>
                    {rows.map((r) => {
                        const composer = `${r.composer_first_name} ${r.composer_last_name}`;
                        return (
                            <div
                                key={r.song_id}
                                onClick={() => { openInNewTab(r.song_id); }}
                                onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openInNewTab(r.song_id); }
                                }}
                                role="link"
                                tabIndex={0}
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: "1.6fr 2fr 1fr", // Composer | Title | Level
                                    padding: "8px 10px",
                                    borderBottom: "1px solid #f0f0f0",
                                    fontSize: 13,
                                    alignItems: "center",
                                    cursor: "pointer",
                                    background: "#fff",
                                    color: "#111",
                                }}
                                title="Open in a new tab"
                            >
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {composer}
                                </div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {r.song_title}
                                </div>
                                <div>{r.skill_level_name}</div>
                            </div>
                        );
                    })}

                    {/* Filler rows to show empty grid lines up to the fixed height */}
                    {(() => {
                        const ROW_HEIGHT = 40; // px (approx: padding + text line)
                        const rowsPerView = Math.floor(960 / ROW_HEIGHT);
                        const fillerCount = Math.max(0, rowsPerView - rows.length);
                        const fillers: React.ReactElement[] = [];
                        for (let i = 0; i < fillerCount; i++) {
                            fillers.push(
                                <div
                                    key={`filler-${i}`}
                                    aria-hidden="true"
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "1.6fr 2fr 1fr", // Composer | Title | Level
                                        padding: "8px 10px",
                                        borderBottom: "1px solid #f0f0f0",
                                        fontSize: 13,
                                        alignItems: "center",
                                        background: "#fff",
                                        color: "transparent", // keep line but hide any content
                                        userSelect: "none",
                                    }}
                                >
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
