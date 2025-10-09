"use client";

import React from "react";

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
};

export default function SongListPanel(): React.ReactElement {
    const [rows, setRows] = React.useState<SongListItem[]>([]);

    React.useEffect(() => {
        let cancelled = false;

        async function fetchList(): Promise<void> {
            try {
                // Server returns sorted by title asc; no UI sort controls here.
                const res = await fetch(`/api/songlist?sort=song_title&dir=asc&limit=1000`, { cache: "no-store" });
                if (!res.ok) {
                    // silent fail to keep UI "data only"
                    return;
                }
                const json: { items?: SongListItem[] } = await res.json();
                if (!cancelled) {
                    setRows(Array.isArray(json.items) ? json.items : []);
                }
            } catch {
                // keep silent; no status UI per requirements
            }
        }

        void fetchList();
        return () => { cancelled = true; };
    }, []);

    const openInNewTab = (id: number): void => {
        const url = `/viewer?src=${encodeURIComponent(`/api/song/${id}/mxl`)}`;
        window.open(url, "_blank", "noopener,noreferrer");
    };

    return (
        <section
            aria-labelledby="song-list-h"
            style={{
                // isolate visually: narrower than full window, centered
                width: "min(720px, 92vw)",
                margin: "0 auto",
                border: "1px solid #e5e5e5",
                borderRadius: 6,
                overflow: "hidden",
                background: "#fff",
                color: "#111",
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

            {/* Header (static labels; no sort buttons) */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1.6fr 1fr",
                    padding: "8px 10px",
                    background: "#fafafa",
                    borderBottom: "1px solid #e5e5e5",
                    fontWeight: 600,
                    fontSize: 13,
                    color: "#111",
                }}
            >
                <div>Title</div>
                <div>Composer</div>
                <div>Level</div>
            </div>

            {/* Rows (clickable; keyboard accessible) */}
            <div
                style={{
                    // ~2× taller than before (was ~520px)
                    maxHeight: 1040,
                    overflow: "auto",
                    background: "#fff",
                }}
            >
                {rows.map((r) => {
                    const composer = `${r.composer_first_name} ${r.composer_last_name}`;
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
                                gridTemplateColumns: "2fr 1.6fr 1fr",
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
                                {r.song_title}
                            </div>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {composer}
                            </div>
                            <div>{r.skill_level_name}</div>
                        </div>
                    );
                })}

                {rows.length === 0 && (
                    <div style={{ padding: 12, fontSize: 13, background: "#fff", color: "#111" }}>
                        {/* Keep this minimal per "nothing but raw data"—no spinners/status text */}
                    </div>
                )}
            </div>
        </section>
    );
}
