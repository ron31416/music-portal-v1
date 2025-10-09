// src/app/admin/page.tsx
"use client";

import React from "react";

// --- Config ---

const SAVE_ENDPOINT = "/api/song"; // posts to app/api/song/route.ts
const XML_PREVIEW_HEIGHT = 420;    // adjust MusicXML textarea height

type SaveResponse = {
    ok?: boolean;
    song_id?: number;
    error?: string;
    message?: string;
};

// --- Types ---

type SongListItem = {
    song_id: number;
    song_title: string;
    composer_first_name: string;
    composer_last_name: string;
    skill_level_name: string;
    skill_level_number: number;
    file_name: string;
    inserted_datetime: string;
    updated_datetime: string;
};

type Level = { number: number; name: string };

type SortDir = "asc" | "desc";

// --- Helpers ---

function firstText(doc: Document, selector: string): string {
    const el = doc.querySelector(selector);
    const raw = el?.textContent ?? "";
    return collapseWs(raw);
}

function firstNonEmpty(...vals: (string | undefined)[]): string {
    for (const v of vals) {
        if (v && v.trim()) {
            return v.trim();
        }
    }
    return "";
}

function stripExt(name: string): string {
    const lower = (name || "").toLowerCase();
    if (lower.endsWith(".musicxml")) {
        return name.slice(0, -10);
    }
    if (lower.endsWith(".mxl")) {
        return name.slice(0, -4);
    }
    return name;
}

function collapseWs(s: string): string {
    let out = "";
    let inWs = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const ws = ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
        if (ws) {
            if (!inWs) {
                out += " ";
                inWs = true;
            }
        } else {
            out += ch;
            inWs = false;
        }
    }
    return out.trim();
}

function bytesToBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]!);
    }
    return btoa(s);
}

function findRootfilePath(containerXml: string): string {
    const doc = new DOMParser().parseFromString(containerXml, "application/xml");
    const el = doc.querySelector("rootfile[full-path], rootfile[path], rootfile[href]");
    const p = el?.getAttribute("full-path") || el?.getAttribute("path") || el?.getAttribute("href") || "";
    if (!p) {
        throw new Error("MXL: META-INF/container.xml rootfile path missing");
    }
    return p;
}

function extractFromMusicXml(xmlText: string, fallbackName: string): { title: string; composer: string } {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) {
        throw new Error("Invalid MusicXML (parsererror)");
    }

    const songTitle = firstText(doc, "song > song-title");
    const movementTitle = firstText(doc, "movement-title");
    const creditWords = firstText(doc, "credit > credit-words");
    const title = firstNonEmpty(songTitle, movementTitle, creditWords, stripExt(fallbackName));

    const composerTyped = firstText(doc, 'identification > creator[type="composer"]');
    const anyCreator = firstText(doc, "identification > creator");
    const composer = firstNonEmpty(composerTyped, anyCreator, "");

    return { title, composer };
}

async function extractMetadataAndXml(
    file: File,
    kind: { isMxl: boolean; isXml: boolean }
): Promise<{ title: string; composer: string; xmlText: string }> {
    if (kind.isXml) {
        const xmlText = await file.text();
        const meta = extractFromMusicXml(xmlText, file.name);
        return { ...meta, xmlText };
    }
    if (kind.isMxl) {
        const { unzip } = await import("unzipit");
        const { entries } = await unzip(await file.arrayBuffer());
        const container = entries["META-INF/container.xml"];
        if (!container) {
            throw new Error("MXL: META-INF/container.xml missing");
        }
        const containerXml = await container.text();
        const rootPath = findRootfilePath(containerXml);
        const root = entries[rootPath];
        if (!root) {
            throw new Error(`MXL: rootfile missing in archive: ${rootPath}`);
        }
        const xmlText = await root.text();
        const meta = extractFromMusicXml(xmlText, file.name);
        return { ...meta, xmlText };
    }
    throw new Error("Unsupported file type");
}

// Build a proper .mxl (ZIP) from full XML text for saving
async function xmlToMxl(xmlText: string, innerNameHint: string): Promise<Uint8Array> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();

    const base = stripExt(innerNameHint || "score");
    const innerName = `${base}.musicxml`;

    zip.file(
        "META-INF/container.xml",
        `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="${innerName}" media-type="application/vnd.recordare.musicxml+xml"/>
  </rootfiles>
</container>`
    );

    zip.file(innerName, xmlText);

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// Accept only the new shape returned by /api/skill-level
function isLevel(x: unknown): x is Level {
    if (typeof x !== "object" || x === null) {
        return false;
    }
    const r = x as Record<string, unknown>;
    return typeof r.number === "number" && Number.isFinite(r.number) && typeof r.name === "string";
}

// --- UI Helpers ---

function HeaderButton(props: {
    label: string;
    sortToken: string;      // single token sent to server (primary column)
    curSort: string | null; // null => let DB default
    dir: SortDir;
    onClick: (k: string) => void;
}) {
    const active = props.curSort === props.sortToken;
    const caret = active ? (props.dir === "asc" ? "▲" : "▼") : "";
    return (
        <button
            type="button"
            onClick={() => {
                props.onClick(props.sortToken);
            }}
            title={`Sort by ${props.label}`}
            style={{ textAlign: "left", fontWeight: 600, fontSize: 13, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
        >
            {props.label} {caret}
        </button>
    );
}

// --- Styles ---

const roStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fdfdfd",
    color: "#111",
};

// --- Component ---

export default function AdminPage(): React.ReactElement {
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [saveOk, setSaveOk] = React.useState("");

    // Load Song list state
    const [showList, setShowList] = React.useState(false);
    const [listLoading, setListLoading] = React.useState(false);
    const [listError, setListError] = React.useState("");
    const [songs, setSongs] = React.useState<SongListItem[]>([]);
    // Server sorting only: no default token (DB will default to composer)
    const [sort, setSort] = React.useState<string | null>(null);
    const [sortDir, setSortDir] = React.useState<SortDir>("asc");

    // fields
    const [title, setTitle] = React.useState("");
    const [composerFirst, setComposerFirst] = React.useState("");
    const [composerLast, setComposerLast] = React.useState("");
    const [level, setLevel] = React.useState(""); // holds selected level_number as string
    const [levels, setLevels] = React.useState<Level[]>([]);
    const [levelsLoading, setLevelsLoading] = React.useState(false);
    const [levelsError, setLevelsError] = React.useState("");
    const [fileName, setFileName] = React.useState("");
    const [xmlPreview, setXmlPreview] = React.useState("");

    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // fetch skill levels once (do NOT default-select)
    React.useEffect(() => {
        let cancelled = false;

        async function loadLevels(): Promise<void> {
            try {
                setLevelsLoading(true);
                setLevelsError("");
                const res = await fetch("/api/skill-level", { cache: "no-store" });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const json = (await res.json()) as unknown;
                const payloadLevels = (json && typeof json === "object" && (json as Record<string, unknown>).levels) as unknown;

                if (cancelled) {
                    return;
                }

                if (Array.isArray(payloadLevels)) {
                    const normalized: Level[] = [];
                    for (const item of payloadLevels) {
                        if (isLevel(item)) {
                            normalized.push(item);
                        }
                    }
                    setLevels(normalized);
                } else {
                    setLevels([]);
                }
            } catch (e) {
                if (!cancelled) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setLevelsError(msg);
                    setLevels([]);
                }
            } finally {
                if (!cancelled) {
                    setLevelsLoading(false);
                }
            }
        }

        void loadLevels();
        return () => {
            cancelled = true;
        };
    }, []);

    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setSaveOk("");
        setParsing(false);
        setTitle("");
        setComposerFirst("");
        setComposerLast("");
        setLevel(""); // force a fresh selection for each file
        setFileName("");
        setXmlPreview("");

        const f = e.target.files?.[0] ?? null;
        if (!f) {
            setFile(null);
            return;
        }

        const lower = (f.name || "").toLowerCase();
        const isMxl = lower.endsWith(".mxl") || lower.endsWith(".zip");
        const isXml = lower.endsWith(".musicxml") || lower.endsWith(".xml");
        if (!isMxl && !isXml) {
            setError("Please select a .mxl or .musicxml file.");
            setFile(null);
            return;
        }

        setFile(f);
        setFileName(f.name);
        setParsing(true);

        try {
            const meta = await extractMetadataAndXml(f, { isMxl, isXml });
            setTitle(meta.title || "");
            setComposerFirst(meta.composer || "");
            setComposerLast("");
            setXmlPreview(meta.xmlText || "");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setParsing(false);
        }
    };

    // ---- client-side string checks ----
    function hasLeadingSpace(s: string): boolean {
        return s.length > 0 && s[0] === " ";
    }
    function hasDoubleSpace(s: string): boolean {
        return s.includes("  ");
    }
    function rtrimSpaces(s: string): string {
        return s.replace(/[ \t]+$/u, "");
    }
    function isInLevels(val: string): boolean {
        const n = Number(val);
        if (!Number.isFinite(n)) {
            return false;
        }
        for (const l of levels) {
            if (l.number === n) {
                return true;
            }
        }
        return false;
    }

    const onSave = async (): Promise<void> => {
        setError("");
        setSaveOk("");

        if (!file) {
            setError("No file selected.");
            return;
        }

        const titleTrimmed = rtrimSpaces(title);
        const firstTrimmed = rtrimSpaces(composerFirst);
        const lastTrimmed = rtrimSpaces(composerLast);

        // Required: title and explicit level selection (no default)
        if (titleTrimmed.length === 0) {
            setError("Title is required.");
            return;
        }
        if (level.length === 0) {
            setError("Skill level is required.");
            return;
        }
        if (!isInLevels(level)) {
            setError("Skill level value is not in the list.");
            return;
        }

        // Leading / double-space rules
        if (hasLeadingSpace(titleTrimmed)) {
            setError("Title must not start with a space.");
            return;
        }
        if (hasDoubleSpace(titleTrimmed)) {
            setError("Title must not contain double spaces.");
            return;
        }

        if (firstTrimmed.length > 0) {
            if (hasLeadingSpace(firstTrimmed)) {
                setError("Composer first name must not start with a space.");
                return;
            }
            if (hasDoubleSpace(firstTrimmed)) {
                setError("Composer first name must not contain double spaces.");
                return;
            }
        }
        if (lastTrimmed.length > 0) {
            if (hasLeadingSpace(lastTrimmed)) {
                setError("Composer last name must not start with a space.");
                return;
            }
            if (hasDoubleSpace(lastTrimmed)) {
                setError("Composer last name must not contain double spaces.");
                return;
            }
        }

        try {
            setSaving(true);

            // Source of truth = the full XML currently in the textarea
            const xmlText = xmlPreview;
            if (!xmlText || !xmlText.trim()) {
                setError("Empty XML — nothing to save.");
                return;
            }

            // Re-pack XML → .mxl (ZIP)
            const mxlBytes = await xmlToMxl(xmlText, fileName || file?.name || titleTrimmed || "score");
            const base64 = bytesToBase64(mxlBytes);

            // Ensure .mxl filename on save
            const outFileName = (() => {
                const name = fileName || file?.name || `${titleTrimmed || "score"}.mxl`;
                if (name.toLowerCase().endsWith(".mxl")) {
                    return name;
                } else {
                    return `${stripExt(name)}.mxl`;
                }
            })();

            const payload = {
                song_title: titleTrimmed,
                composer_first_name: firstTrimmed,
                composer_last_name: lastTrimmed,
                skill_level_number: Number(level),
                file_name: outFileName,
                song_mxl_base64: base64,
            };

            const res = await fetch(SAVE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            let json: SaveResponse | null = null;
            const ct = res.headers.get("content-type") ?? "";
            if (ct.includes("application/json")) {
                json = (await res.json()) as SaveResponse;
            }

            if (!res.ok) {
                const message = (json && (json.message || json.error)) || (await res.text()) || `Save failed (HTTP ${res.status})`;
                setError(message);
                return;
            }

            setSaveOk("Saved");
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    // ---- Admin Modal List (server-sorted) ----
    const openList = async (overrideSort?: string, overrideDir?: SortDir): Promise<void> => {
        setShowList(true);
        setListError("");
        setListLoading(true);
        try {
            const params = new URLSearchParams();
            params.set("limit", "1000");

            const effSort = overrideSort ?? sort;
            const effDir: SortDir = overrideDir ?? sortDir;

            // Only send sort params if explicitly set; DB defaults otherwise
            if (effSort !== null) {
                params.set("sort", effSort);
                params.set("dir", effDir);
            }

            const res = await fetch(`/api/songlist?${params.toString()}`, { cache: "no-store" });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const json = (await res.json()) as unknown;
            const items = (json && typeof json === "object" ? (json as Record<string, unknown>).items : []) as unknown;
            if (Array.isArray(items)) {
                const cast: SongListItem[] = [];
                for (const it of items) {
                    if (it && typeof it === "object") {
                        const r = it as Record<string, unknown>;
                        const id = r.song_id;
                        if (typeof id === "number" && Number.isFinite(id)) {
                            cast.push({
                                song_id: id,
                                song_title: String(r.song_title ?? ""),
                                composer_first_name: String(r.composer_first_name ?? ""),
                                composer_last_name: String(r.composer_last_name ?? ""),
                                skill_level_name: String(r.skill_level_name ?? ""),
                                skill_level_number: Number(r.skill_level_number ?? 0),
                                file_name: String(r.file_name ?? ""),
                                inserted_datetime: String(r.inserted_datetime ?? ""),
                                updated_datetime: String(r.updated_datetime ?? ""),
                            });
                        }
                    }
                }
                setSongs(cast);
            } else {
                setSongs([]);
            }
        } catch (e) {
            setListError(e instanceof Error ? e.message : String(e));
            setSongs([]);
        } finally {
            setListLoading(false);
        }
    };

    const toggleSort = (key: string): void => {
        const newDir: SortDir = (sort === key) ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        setSort(key);
        setSortDir(newDir);
        void openList(key, newDir); // refetch immediately with explicit token
    };

    const loadSongRow = async (item: SongListItem): Promise<void> => {
        try {
            setError("");
            setSaveOk("");
            setTitle(item.song_title || "");
            setComposerFirst(item.composer_first_name || "");
            setComposerLast(item.composer_last_name || "");
            // set numeric level value (as string) for <select>
            setLevel(item.skill_level_number ? String(item.skill_level_number) : "");
            setFileName(item.file_name || "");

            const res = await fetch(`/api/song/${item.song_id}/mxl`, { cache: "no-store" });
            if (!res.ok) {
                throw new Error(`Fetch file failed (HTTP ${res.status})`);
            }
            const blob = await res.blob();

            const ct = res.headers.get("content-type") || "";
            const isMxlByCt = ct.includes("musicxml+zip");
            const isXmlByCt = ct.includes("musicxml+xml") && !isMxlByCt;

            const lower = (item.file_name || "").toLowerCase();
            const isMxlByName = lower.endsWith(".mxl") || lower.endsWith(".zip");
            const isXmlByName = lower.endsWith(".musicxml") || lower.endsWith(".xml");

            const isMxl = isMxlByCt || isMxlByName;
            const isXml = (!isMxl) && (isXmlByCt || isXmlByName);

            const type = ct || (isMxl ? "application/vnd.recordare.musicxml+zip" : "application/vnd.recordare.musicxml+xml");
            const f = new File([blob], item.file_name || (isMxl ? "song.mxl" : "song.musicxml"), { type });

            setFile(f);
            const meta = await extractMetadataAndXml(f, { isMxl, isXml });
            setXmlPreview(meta.xmlText || "");
            setShowList(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            {/* Top bar: Load button */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <button
                    type="button"
                    onClick={() => {
                        void openList();
                    }}
                    style={{
                        padding: "8px 12px",
                        border: "1px solid #aaa",
                        borderRadius: 6,
                        background: "#fafafa",
                        cursor: "pointer",
                        color: "#111",
                    }}
                >
                    Load Song
                </button>

                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                    <input
                        ref={fileInputRef}
                        id="song-file-input"
                        type="file"
                        accept=".mxl,.musicxml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,application/zip"
                        onChange={onPick}
                        style={{ display: "none" }}
                    />
                    <button
                        type="button"
                        onClick={() => {
                            if (fileInputRef.current) {
                                fileInputRef.current.click();
                            }
                        }}
                        style={{
                            padding: "8px 12px",
                            border: "1px solid #aaa",
                            borderRadius: 6,
                            background: "#fafafa",
                            cursor: "pointer",
                            color: "#111",
                        }}
                    >
                        Load File
                    </button>
                    {parsing && (<span aria-live="polite" style={{ alignSelf: "center" }}>Parsing…</span>)}
                </div>
            </div>

            {/* Card only after a file is selected */}
            {(file || xmlPreview || title || composerFirst || composerLast || level) && (
                <section aria-labelledby="add-song-h">
                    <h2
                        id="add-song-h"
                        style={{
                            position: "absolute",
                            width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden",
                            clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
                        }}
                    >
                        Add song
                    </h2>

                    <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fff", color: "#000" }}>
                        <div
                            style={{
                                marginTop: 0,
                                display: "grid",
                                gridTemplateColumns: "120px 1fr",
                                rowGap: 10,
                                columnGap: 12,
                            }}
                        >
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Song Title</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                }}
                                style={roStyle}
                            />

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <input
                                    type="text"
                                    value={composerFirst}
                                    onChange={(e) => {
                                        setComposerFirst(e.target.value);
                                    }}
                                    placeholder="First"
                                    style={roStyle}
                                />
                                <input
                                    type="text"
                                    value={composerLast}
                                    onChange={(e) => {
                                        setComposerLast(e.target.value);
                                    }}
                                    placeholder="Last"
                                    style={roStyle}
                                />
                            </div>

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Skill Level</label>
                            <select
                                value={level}
                                onChange={(e) => {
                                    setLevel(e.target.value);
                                }}
                                disabled={levelsLoading || !!levelsError || levels.length === 0}
                                style={{ ...roStyle, appearance: "auto" as const }}
                            >
                                {/* disabled placeholder so the field starts blank */}
                                <option value="" disabled>
                                    — Select a level —
                                </option>
                                {levels.map((lvl) => {
                                    return (
                                        <option key={lvl.number} value={String(lvl.number)}>
                                            {lvl.name}
                                        </option>
                                    );
                                })}
                            </select>

                            {levelsError && (
                                <div style={{ gridColumn: "1 / span 2", color: "#b00020" }}>
                                    Failed to load skill levels: {levelsError}
                                </div>
                            )}

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>File Name</label>
                            <input type="text" value={fileName} readOnly style={roStyle} />

                            <label style={{ alignSelf: "start", fontWeight: 600, paddingTop: 6 }}>MusicXML</label>
                            <textarea
                                aria-label="XML"
                                value={xmlPreview}
                                onChange={(e) => {
                                    setXmlPreview(e.target.value);
                                }}
                                spellCheck={false}
                                style={{
                                    width: "100%",
                                    margin: 0,
                                    background: "#fff",
                                    border: "1px solid #ccc",
                                    borderRadius: 6,
                                    padding: "8px 10px",
                                    minHeight: XML_PREVIEW_HEIGHT,
                                    maxHeight: XML_PREVIEW_HEIGHT,
                                    overflow: "auto",
                                    resize: "vertical",
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                    fontSize: 13,
                                    color: "#000",
                                    lineHeight: 1.4,
                                }}
                            />
                        </div>

                        <div
                            style={{
                                marginTop: 16,
                                display: "flex",
                                alignItems: "center",
                                gap: 12,
                            }}
                        >
                            <span
                                aria-live="polite"
                                role={error ? "alert" : saveOk ? "status" : undefined}
                                title={error || saveOk || ""}
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    textAlign: "right",
                                    color: error ? "#b00020" : "#111",
                                    fontWeight: 500,
                                    margin: 0,
                                    visibility: (error || saveOk) ? "visible" : "hidden",
                                }}
                            >
                                {error || saveOk || ""}
                            </span>

                            <button
                                type="button"
                                onClick={onSave}
                                disabled={saving}
                                style={{
                                    padding: "8px 12px",
                                    border: "1px solid #aaa",
                                    borderRadius: 6,
                                    background: saving ? "#eee" : "#fafafa",
                                    cursor: saving ? "default" : "pointer",
                                    marginLeft: "auto",
                                }}
                            >
                                {saving ? "Saving…" : "Save Song"}
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {showList && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Select a song"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setShowList(false);
                        }
                    }}
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 12,
                        zIndex: 50,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: "min(860px, 96vw)",
                            background: "#fff",
                            color: "#000",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            padding: 16,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                        }}
                    >
                        {/* Header */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Select a Song</h3>
                            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        void openList(sort ?? undefined, sortDir);
                                    }}
                                    style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: "#fafafa", cursor: "pointer" }}
                                >
                                    Refresh
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowList(false)}
                                    style={{ padding: "6px 10px", border: "1px solid #aaa", borderRadius: 6, background: "#f5f5f5", cursor: "pointer" }}
                                >
                                    Close
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        {listLoading && <p>Loading…</p>}
                        {listError && <p style={{ color: "#b00020" }}>Error: {listError}</p>}

                        {!listLoading && !listError && (
                            <div style={{ border: "1px solid #e5e5e5", borderRadius: 6, overflow: "hidden" }}>
                                {/* Table header */}
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "2fr 1.3fr 1fr 1.3fr",
                                        padding: "8px 10px",
                                        background: "#fafafa",
                                        borderBottom: "1px solid #e5e5e5",
                                        fontWeight: 600,
                                        fontSize: 13,
                                    }}
                                >
                                    <HeaderButton label="Title" sortToken="song_title" curSort={sort} dir={sortDir} onClick={toggleSort} />
                                    <HeaderButton label="Composer" sortToken="composer_last_name" curSort={sort} dir={sortDir} onClick={toggleSort} />
                                    <HeaderButton label="Level" sortToken="skill_level_number" curSort={sort} dir={sortDir} onClick={toggleSort} />
                                    <HeaderButton label="Updated" sortToken="updated_datetime" curSort={sort} dir={sortDir} onClick={toggleSort} />
                                </div>

                                {/* Table rows */}
                                <div style={{ maxHeight: 420, overflow: "auto" }}>
                                    {songs.map((r) => {
                                        const composer = `${r.composer_first_name} ${r.composer_last_name}`;
                                        const updated = new Date(r.updated_datetime).toLocaleString();
                                        return (
                                            <div
                                                key={r.song_id}
                                                onClick={() => {
                                                    void loadSongRow(r);
                                                }}
                                                onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault();
                                                        void loadSongRow(r);
                                                    }
                                                }}
                                                role="button"
                                                tabIndex={0}
                                                style={{
                                                    display: "grid",
                                                    gridTemplateColumns: "2fr 1.3fr 1fr 1.3fr",
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
                                            </div>
                                        );
                                    })}
                                    {songs.length === 0 && <div style={{ padding: 12, fontSize: 13 }}>No songs found.</div>}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
