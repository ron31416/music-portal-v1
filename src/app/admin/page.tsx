// src/app/admin/page.tsx
"use client";

import React from "react";
import { SONG_COL, type SongColToken } from "@/lib/songCols";

// --- Config ---

const SAVE_ENDPOINT = "/api/song";
const SONG_LIST_ENDPOINT = "/api/songlist";
const XML_PREVIEW_HEIGHT = 420;

// --- Table Config (admin list) ---
const TABLE_ROW_PX = 28;                 // height of a single row
const TABLE_VISIBLE_ROWS = 15;           // fixed number of visible rows
const TABLE_BODY_PX = TABLE_ROW_PX * TABLE_VISIBLE_ROWS;

const TABLE_HEADER_BG = "#1b1b1b";       // dark header background
const TABLE_HEADER_FG = "#ffffff";       // header text (white)
const TABLE_BORDER = "#2a2a2a";          // table border + grid lines

const TABLE_ROW_BG_EVEN = "#0e0e0e";     // zebra even
const TABLE_ROW_BG_ODD = "#141414";     // zebra odd
const TABLE_ROW_FG = "#e6e6e6";     // body text

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
    sortToken: SongColToken;
    curSort: SongColToken | null;
    dir: SortDir;
    onClick: (k: SongColToken) => void;
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
    // File / edit state
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [saveOk, setSaveOk] = React.useState("");

    // Song list state (inline, always visible)
    const [songs, setSongs] = React.useState<SongListItem[]>([]);
    const [listLoading, setListLoading] = React.useState(false);
    const [listError, setListError] = React.useState("");

    // Server sorting only
    const [sort, setSort] = React.useState<SongColToken | null>(null);
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

    const [songId, setSongId] = React.useState<number | null>(null);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const listAbortRef = React.useRef<AbortController | null>(null);
    const listSeqRef = React.useRef(0);
    const mxlAbortRef = React.useRef<AbortController | null>(null);
    const mxlSeqRef = React.useRef(0);

    // Fast lookup for duplicates: file_name -> song_id (exact, case-sensitive)
    const fileNameToIdRef = React.useRef<Map<string, number>>(new Map());

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

    // fetch list on mount
    React.useEffect(() => {
        void refreshSongList();
        return () => {
            if (listAbortRef.current !== null) {
                listAbortRef.current.abort();
            }
            if (mxlAbortRef.current !== null) {
                mxlAbortRef.current.abort();
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refreshSongList(overrideSort?: SongColToken | null, overrideDir?: SortDir): Promise<void> {
        setListError("");
        setListLoading(true);

        if (listAbortRef.current !== null) {
            listAbortRef.current.abort();
        }
        const controller = new AbortController();
        listAbortRef.current = controller;
        const seq = listSeqRef.current + 1;
        listSeqRef.current = seq;

        try {
            const params = new URLSearchParams();
            params.set("limit", "5000"); // generous ceiling
            const effSort = overrideSort ?? sort;
            const effDir: SortDir = overrideDir ?? sortDir;

            if (effSort !== null) {
                params.set("sort", effSort);
                params.set("dir", effDir);
            }

            const res = await fetch(`${SONG_LIST_ENDPOINT}?${params.toString()}`, {
                cache: "no-store",
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const json = (await res.json()) as unknown;

            if (seq !== listSeqRef.current) {
                return; // stale
            }

            const items = (json && typeof json === "object" ? (json as Record<string, unknown>).items : []) as unknown;

            const cast: SongListItem[] = [];
            if (Array.isArray(items)) {
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
            }
            setSongs(cast);

            // rebuild exact filename map
            const m = new Map<string, number>();
            for (const row of cast) {
                if (row.file_name && typeof row.song_id === "number") {
                    m.set(row.file_name, row.song_id);
                }
            }
            fileNameToIdRef.current = m;
        } catch (e: unknown) {
            const name = (e as { name?: string } | null)?.name ?? "";
            if (name === "AbortError") {
                return;
            }
            setListError(e instanceof Error ? e.message : String(e));
            setSongs([]);
            fileNameToIdRef.current = new Map();
        } finally {
            if (seq === listSeqRef.current) {
                setListLoading(false);
            }
        }
    }

    const toggleSort = (key: SongColToken): void => {
        const nextDir: SortDir = (sort === key) ? (sortDir === "asc" ? "desc" : "asc") : "asc";
        setSort(key);
        setSortDir(nextDir);
        void refreshSongList(key, nextDir);
    };

    const loadSongRow = async (item: SongListItem): Promise<void> => {
        try {
            setError("");
            setSaveOk("");
            setSongId(item.song_id);

            if (mxlAbortRef.current !== null) {
                mxlAbortRef.current.abort();
            }
            const controller = new AbortController();
            mxlAbortRef.current = controller;
            const seq = mxlSeqRef.current + 1;
            mxlSeqRef.current = seq;

            setTitle(item.song_title || "");
            setComposerFirst(item.composer_first_name || "");
            setComposerLast(item.composer_last_name || "");
            setLevel(item.skill_level_number ? String(item.skill_level_number) : "");
            setFileName(item.file_name || "");

            const res = await fetch(`/api/song/${item.song_id}/mxl`, { cache: "no-store", signal: controller.signal });
            if (!res.ok) {
                const ct = res.headers.get("content-type") || "";
                let detail = `HTTP ${res.status}`;
                if (ct.includes("application/json")) {
                    try {
                        const j = await res.json();
                        const msg = (j && typeof j === "object" ? (j as Record<string, unknown>).message : "") as unknown;
                        if (typeof msg === "string" && msg.trim().length > 0) {
                            detail = msg;
                        }
                    } catch {
                        // ignore json parse
                    }
                } else if (ct.startsWith("text/")) {
                    try {
                        const t = await res.text();
                        if (t) {
                            detail = t.slice(0, 200);
                        }
                    } catch {
                        // ignore text read
                    }
                }
                throw new Error(`Fetch file failed: ${detail}`);
            }

            const blob = await res.blob();
            if (seq !== mxlSeqRef.current) {
                return; // ignore stale
            }

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
            if (seq !== mxlSeqRef.current) {
                return; // ignore stale
            }
            setXmlPreview(meta.xmlText || "");
        } catch (e: unknown) {
            const name = (e as { name?: string } | null)?.name ?? "";
            if (name === "AbortError") {
                return;
            }
            setError(e instanceof Error ? e.message : String(e));
        }
    };

    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setSaveOk("");
        setParsing(false);
        setSongId(null);
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

        // Duplicate check using in-memory map (exact, case-sensitive)
        const existingId = fileNameToIdRef.current.get(f.name);
        if (typeof existingId === "number") {
            window.alert(`This file has already been loaded (song_id=${existingId}).`);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
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
                [SONG_COL.songId]: songId,
                [SONG_COL.songTitle]: titleTrimmed,
                [SONG_COL.composerFirstName]: firstTrimmed,
                [SONG_COL.composerLastName]: lastTrimmed,
                [SONG_COL.skillLevelNumber]: Number(level),
                [SONG_COL.fileName]: outFileName,
                [SONG_COL.songMxl]: base64,
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

            if (json && typeof json.song_id === "number" && Number.isFinite(json.song_id)) {
                setSongId(json.song_id);
            }

            setSaveOk("Saved");

            // Reset input so the same file selection can trigger again if needed
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            // Refresh list so the new row appears and the duplicate map is updated
            await refreshSongList();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            {/* Top: Load File UI (always visible) */}
            <section className="space-y-2" aria-labelledby="load-file-h">
                <h2 id="load-file-h" style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>Load File</h2>

                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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

                {/* Card only after a file is selected / fields populated */}
                {(file || xmlPreview || title || composerFirst || composerLast || level) && (
                    <section aria-labelledby="add-song-h">
                        <h3
                            id="add-song-h"
                            style={{
                                position: "absolute",
                                width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden",
                                clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
                            }}
                        >
                            Add song
                        </h3>

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
            </section>

            {/* Inline song list (always visible) */}
            <section className="space-y-2" aria-labelledby="songs-h" style={{ marginTop: 24 }}>
                <h2 id="songs-h" style={{ marginTop: 0, fontSize: 18, fontWeight: 600, color: "#fff" }}>Songs</h2>

                {listLoading && <p style={{ color: "#ddd" }}>Loading…</p>}
                {listError && <p style={{ color: "#ff6b6b" }}>Error: {listError}</p>}

                {!listLoading && !listError && (
                    <div
                        style={{
                            border: `1px solid ${TABLE_BORDER}`,
                            borderRadius: 6,
                            overflow: "hidden",
                            background: "#0b0b0b",
                        }}
                    >
                        {/* Table header (dark) */}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1.3fr 1.3fr 2fr 1fr 1.3fr",
                                padding: "8px 10px",
                                background: TABLE_HEADER_BG,
                                color: TABLE_HEADER_FG,
                                borderBottom: `1px solid ${TABLE_BORDER}`,
                                fontWeight: 600,
                                fontSize: 13,
                            }}
                        >
                            <HeaderButton label="Composer Last" sortToken={SONG_COL.composerLastName} curSort={sort} dir={sortDir} onClick={toggleSort} />
                            <HeaderButton label="Composer First" sortToken={SONG_COL.composerFirstName} curSort={sort} dir={sortDir} onClick={toggleSort} />
                            <HeaderButton label="Song Title" sortToken={SONG_COL.songTitle} curSort={sort} dir={sortDir} onClick={toggleSort} />
                            <HeaderButton label="Skill Level" sortToken={SONG_COL.skillLevelNumber} curSort={sort} dir={sortDir} onClick={toggleSort} />
                            <HeaderButton label="File Name" sortToken={SONG_COL.fileName} curSort={sort} dir={sortDir} onClick={toggleSort} />
                        </div>

                        {/* Table body (fixed height = 15 rows) */}
                        <div
                            style={{
                                minHeight: TABLE_BODY_PX,
                                maxHeight: TABLE_BODY_PX,
                                overflow: "auto",
                                borderTop: `1px solid ${TABLE_BORDER}`,
                            }}
                            aria-busy={listLoading}
                        >
                            {/* Data rows */}
                            {songs.map((r, idx) => {
                                const bg = (idx % 2 === 0) ? TABLE_ROW_BG_EVEN : TABLE_ROW_BG_ODD;
                                return (
                                    <div
                                        key={r.song_id}
                                        onClick={() => { void loadSongRow(r); }}
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
                                            gridTemplateColumns: "1.3fr 1.3fr 2fr 1fr 1.3fr",
                                            padding: "8px 10px",
                                            borderBottom: `1px solid ${TABLE_BORDER}`,
                                            fontSize: 13,
                                            alignItems: "center",
                                            cursor: "pointer",
                                            background: bg,
                                            color: TABLE_ROW_FG,
                                            height: TABLE_ROW_PX,
                                            lineHeight: `${TABLE_ROW_PX - 10}px`, // visual centering
                                        }}
                                    >
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.composer_last_name || "\u2014"}</div>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.composer_first_name || "\u2014"}</div>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.song_title}</div>
                                        <div>{r.skill_level_name}</div>
                                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.file_name || "\u2014"}</div>
                                    </div>
                                );
                            })}

                            {/* Padding rows (if fewer than 15) */}
                            {songs.length < TABLE_VISIBLE_ROWS && Array.from({ length: TABLE_VISIBLE_ROWS - songs.length }).map((_, i) => {
                                const idx = songs.length + i;
                                const bg = (idx % 2 === 0) ? TABLE_ROW_BG_EVEN : TABLE_ROW_BG_ODD;
                                return (
                                    <div
                                        key={`pad-${i}`}
                                        aria-hidden="true"
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1.3fr 1.3fr 2fr 1fr 1.3fr",
                                            padding: "8px 10px",
                                            borderBottom: `1px solid ${TABLE_BORDER}`,
                                            fontSize: 13,
                                            alignItems: "center",
                                            background: bg,
                                            color: TABLE_ROW_FG,
                                            height: TABLE_ROW_PX,
                                        }}
                                    >
                                        <div>&nbsp;</div>
                                        <div>&nbsp;</div>
                                        <div>&nbsp;</div>
                                        <div>&nbsp;</div>
                                        <div>&nbsp;</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </section>
        </main>
    );
}
