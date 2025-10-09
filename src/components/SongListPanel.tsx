"use client";

import React from "react";
import { useRouter } from "next/navigation";

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

type SortKey = "song_title" | "composer_last_name" | "composer_first_name" | "skill_level_name";
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
    const router = useRouter();

    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    const [rows, setRows] = React.useState<SongListItem[]>([]);
    const [sortKey, setSortKey] = React.useState<SortKey>("song_title");
    const [sortDir, setSortDir] = React.useState<SortDir>("asc");

    const fetchList = async (): Promise<void> => {
        try {
            setLoading(true);
            setError("");

            // IMPORTANT: use the new API path
            const res = await fetch(`/api/songlist?sort=song_title&dir=asc&limit=1000`, { cache: "no-store" });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const json: { items?: SongListItem[] } = await res.json();
            setRows(Array.isArray(json.items) ? json.items : []);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setRows([]);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        void fetchList();
    }, []);

    const sortedRows = React.useMemo(() => {
        const copy = rows.slice();
        const dir = sortDir === "asc" ? 1 : -1;

        return copy.sort((a, b) => {
            const av = String(a[sortKey] ?? "");
            const bv = String(b[sortKey] ?? "");
            return av.localeCompare(bv) * dir;
        });
    }, [rows, sortKey, sortDir]);

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

    const openViewer = (item: SongListItem): void => {
        router.push(`/viewer?src=${encodeURIComponent(`/api/song/${item.song_id}/mxl`)}`);
    };

    return (
        <section
            aria-labelledby="song-list-h"
            style={{
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                overflow: "hidden",
                background: "#fff",   // explicit white background to avoid black cells
                color: "#111",        // explicit text color
            }}
        >
            <h3 id="song-list-h" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 }}>
                Song List
            </h3>

            {/* Header */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1.6fr 1fr 0.8fr", // no Updated column
                    padding: "8px 10px",
                    background: "#fafafa",
                    borderBottom: "1px solid #e5e5e5",
                    fontWeight: 600,
                    fontSize: 13,
                    color: "#111",
                }}
            >
                <HeaderButton label="Title" sortKey="song_title" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <HeaderButton label="Composer" sortKey="composer_last_name" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <HeaderButton label="Level" sortKey="skill_level_name" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                <div style={{ textAlign: "right" }}>Action</div>
            </div>

            {/* Rows */}
            <div style={{ maxHeight: 520, overflow: "auto", background: "#fff" }}>
                {sortedRows.map((r) => {
                    const composer = `${r.composer_last_name}${r.composer_last_name && r.composer_first_name ? ", " : ""}${r.composer_first_name}`;
                    return (
                        <div
                            key={r.song_id}
                            onClick={() => { openViewer(r); }}
                            style={{
                                display: "grid",
                                gridTemplateColumns: "2fr 1.6fr 1fr 0.8fr",
                                padding: "8px 10px",
                                borderBottom: "1px solid #f0f0f0",
                                fontSize: 13,
                                alignItems: "center",
                                cursor: "pointer",
                                background: "#fff",   // ensure white cells
                                color: "#111",
                            }}
                        >
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.song_title}</div>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{composer || "\u2014"}</div>
                            <div>{r.skill_level_name}</div>
                            <div style={{ textAlign: "right" }}>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openViewer(r);
                                    }}
                                    style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: "#fafafa", cursor: "pointer", color: "#111" }}
                                >
                                    Open
                                </button>
                            </div>
                        </div>
                    );
                })}
                {sortedRows.length === 0 && (
                    <div style={{ padding: 12, fontSize: 13, background: "#fff", color: "#111" }}>
                        No songs available.
                    </div>
                )}
            </div>

            {/* Footer bar with Refresh + error */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#fff", borderTop: "1px solid #e5e5e5" }}>
                <button
                    type="button"
                    onClick={() => { void fetchList(); }}
                    disabled={loading}
                    style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: loading ? "#eee" : "#fafafa", cursor: loading ? "default" : "pointer", color: "#111" }}
                >
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
                <span
                    aria-live="polite"
                    role={error ? "alert" : "status"}
                    style={{
                        marginLeft: "auto",
                        minWidth: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: error ? "#b00020" : "#111",
                        visibility: error ? "visible" : "hidden",
                    }}
                >
                    {error || ""}
                </span>
            </div>
        </section>
    );
}
