"use client";

import React from "react";
import { useRouter } from "next/navigation";

// --- Types ---

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
    updated_datetime: string;
};

type SortKey =
    | "song_title"
    | "composer_last_name"
    | "composer_first_name"
    | "skill_level_name"
    | "updated_datetime";

type SortDir = "asc" | "desc";

// --- Small UI bits ---

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
            style={{ textAlign: "left", fontWeight: 600, fontSize: 13, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
            {props.label} {caret}
        </button>
    );
}

// --- Page ---

export default function SongListPage(): React.ReactElement {
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
            if (sortKey === "updated_datetime") {
                const av = new Date(a.updated_datetime).getTime();
                const bv = new Date(b.updated_datetime).getTime();
                return (av - bv) * dir;
            }
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
        router.push(`/song/${item.song_id}`);
    };

    return (
        <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px", color: "#000" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Song List</h2>
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button
                        type="button"
                        onClick={() => { void fetchList(); }}
                        style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: "#fafafa", cursor: "pointer" }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {loading && <p>Loading…</p>}
            {error && <p style={{ color: "#b00020" }}>Error: {error}</p>}

            {!loading && !error && (
                <div style={{ border: "1px solid #e5e5e5", borderRadius: 6, overflow: "hidden" }}>
                    {/* Header */}
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "2fr 1.3fr 1fr 1.3fr 0.8fr",
                            padding: "8px 10px",
                            background: "#fafafa",
                            borderBottom: "1px solid #e5e5e5",
                            fontWeight: 600,
                            fontSize: 13,
                        }}
                    >
                        <HeaderButton label="Title" sortKey="song_title" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <HeaderButton label="Composer" sortKey="composer_last_name" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <HeaderButton label="Level" sortKey="skill_level_name" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <HeaderButton label="Updated" sortKey="updated_datetime" curKey={sortKey} dir={sortDir} onClick={toggleSort} />
                        <div style={{ textAlign: "right" }}>Action</div>
                    </div>

                    {/* Rows */}
                    <div style={{ maxHeight: 520, overflow: "auto" }}>
                        {sortedRows.map((r) => {
                            const composer =
                                `${r.composer_last_name}${r.composer_last_name && r.composer_first_name ? ", " : ""}${r.composer_first_name}`;
                            const updated = new Date(r.updated_datetime).toLocaleString();

                            return (
                                <div
                                    key={r.song_id}
                                    onClick={() => { openViewer(r); }}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "2fr 1.3fr 1fr 1.3fr 0.8fr",
                                        padding: "8px 10px",
                                        borderBottom: "1px solid #f0f0f0",
                                        fontSize: 13,
                                        alignItems: "center",
                                        cursor: "pointer",
                                    }}
                                >
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.song_title}</div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{composer || "\u2014"}</div>
                                    <div>{r.skill_level_name}</div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{updated}</div>
                                    <div style={{ textAlign: "right" }}>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                openViewer(r);
                                            }}
                                            style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: "#fafafa", cursor: "pointer" }}
                                        >
                                            Open
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                        {sortedRows.length === 0 && (
                            <div style={{ padding: 12, fontSize: 13 }}>No songs available.</div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
