// src/app/admin/page.tsx
"use client";

import React from "react";
import { SONG_COL, type SongColToken } from "@/lib/songCols";
import { usePrefersDark, themeTokens, fieldStyle } from "@/lib/theme";
import SortHeaderButton from "@/components/common/SortHeaderButton";

// --- Config ---

const SAVE_ENDPOINT = "/api/song";
const SONG_LIST_ENDPOINT = "/api/songlist";
const XML_PREVIEW_HEIGHT = 200;

// --- Table Config (admin list) ---
const TABLE_ROW_PX = 28;                 // height of a single row
const TABLE_ROW_COUNT = 10;              // fixed number of visible rows
const TABLE_BODY_PX = TABLE_ROW_PX * TABLE_ROW_COUNT;

// Fixed grid column widths (Admin list: Last | First | Title | Level | File)
const GRID_COLS = "160px 160px 300px 100px 300px" as const;

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
    color?: string;
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
            style={{
                textAlign: "left",
                fontWeight: 600,
                fontSize: 13,
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: props.color ?? "#111",
            }}
        >
            {props.label} {caret}
        </button>
    );
}

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

    const [statusTick, setStatusTick] = React.useState(0);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const listAbortRef = React.useRef<AbortController | null>(null);
    const listSeqRef = React.useRef(0);
    const mxlAbortRef = React.useRef<AbortController | null>(null);
    const mxlSeqRef = React.useRef(0);

    const isDark = usePrefersDark();
    const T = React.useMemo(() => themeTokens(isDark), [isDark]);        // memoize tokens

    // Type-safe: ensure we expose a React.CSSProperties
    const fieldCss: React.CSSProperties = React.useMemo(() => {
        return fieldStyle(isDark) as React.CSSProperties;
    }, [isDark]);

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

    async function refreshSongList(
        overrideSort?: SongColToken | null,
        overrideDir?: SortDir,
        showSpinner: boolean = true
    ): Promise<void> {

        setListError("");
        if (showSpinner) {
            setListLoading(true);
        }

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

    const openViewer = React.useCallback(() => {
        if (songId !== null) {
            window.open(`/viewer?id=${songId}`, "_blank", "noopener,noreferrer");
        }
    }, [songId]);

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
        if (title !== titleTrimmed) { setTitle(titleTrimmed); }
        if (composerFirst !== firstTrimmed) { setComposerFirst(firstTrimmed); }
        if (composerLast !== lastTrimmed) { setComposerLast(lastTrimmed); }

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

            const wasUpdate = songId !== null;

            if (json && typeof json.song_id === "number" && Number.isFinite(json.song_id)) {
                setSongId(json.song_id);
            }

            // Reset the hidden file input so the same file can be picked again if needed
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            // Refresh the list **silently** (no spinner, no layout dim)
            await refreshSongList(undefined, undefined, false);

            // Make sure saving state is cleared before we show the success text
            setSaving(false);

            // Clear any prior error, then set the final success message **last**
            setError("");
            setSaveOk(wasUpdate ? "Updated" : "Added");
            setStatusTick((t) => t + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    // Decide overflow deterministically: scrolling only when we have more than TABLE_VISIBLE_ROWS real rows
    const needsScroll: boolean = songs.length > TABLE_ROW_COUNT;

    const isUpdate = songId !== null;
    const canAdd = !isUpdate && !!fileName && !parsing && !saving;
    const canUpdate = isUpdate && !saving;
    const canSave = isUpdate ? canUpdate : canAdd;
    const saveLabel = isUpdate ? "Update Song" : "Add Song";
    const canView = songId !== null;

    return (
        <main style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
            {/* ===== SONG LIST (TOP) ===== */}
            <section aria-label="Songs" style={{ marginTop: 0 }}>
                {/* Inline status line, but DO NOT hide the table wrapper */}
                {listError && (
                    <p style={{ color: "#ff6b6b", margin: "4px 0 8px" }}>
                        Error: {listError}
                    </p>
                )}

                <div
                    style={{
                        position: "relative",            // for overlay positioning
                        border: `1px solid ${T.border}`,
                        borderRadius: 6,
                        overflowX: "hidden",
                        overflowY: "hidden",
                        background: T.bgCard,
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
                            <p style={{ color: T.headerFg, opacity: 0.85 }}>Loading…</p>
                        </div>
                    )}

                    {/* Header */}
                    <SortHeaderButton<SongColToken>
                        col={SONG_COL.composerLastName}
                        curSort={sort}
                        dir={sortDir}
                        onToggle={toggleSort}
                        label="Composer Last Name"
                        className="songs-header-btn"
                    />
                    <SortHeaderButton<SongColToken>
                        col={SONG_COL.composerFirstName}
                        curSort={sort}
                        dir={sortDir}
                        onToggle={toggleSort}
                        label="Composer First Name"
                        className="songs-header-btn"
                    />
                    <SortHeaderButton<SongColToken>
                        col={SONG_COL.songTitle}
                        curSort={sort}
                        dir={sortDir}
                        onToggle={toggleSort}
                        label="Song Title"
                        className="songs-header-btn"
                    />
                    <SortHeaderButton<SongColToken>
                        col={SONG_COL.skillLevelNumber}
                        curSort={sort}
                        dir={sortDir}
                        onToggle={toggleSort}
                        label="Skill Level"
                        className="songs-header-btn"
                    />
                    <SortHeaderButton<SongColToken>
                        col={SONG_COL.fileName}
                        curSort={sort}
                        dir={sortDir}
                        onToggle={toggleSort}
                        label="File Name"
                        className="songs-header-btn"
                    />

                    {/* Body: scrollbar only when needed */}
                    <div
                        style={{
                            minHeight: TABLE_BODY_PX,
                            maxHeight: TABLE_BODY_PX,
                            overflowY: needsScroll ? "auto" : "hidden",
                            overflowX: "hidden",
                            borderTop: `1px solid ${T.border}`,
                            opacity: listLoading ? 0.7 : 1,      // keep space; avoid layout jump
                            transition: "opacity 120ms linear",
                        }}
                        aria-busy={listLoading}
                    >
                        {/* Data rows */}
                        {songs.map((r, idx) => {
                            const bg = (idx % 2 === 0) ? T.rowEven : T.rowOdd;
                            return (
                                <div
                                    key={r.song_id}
                                    onClick={() => { void loadSongRow(r); }}
                                    onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void loadSongRow(r); }
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: GRID_COLS,
                                        padding: "8px 10px",
                                        borderBottom: `1px solid ${T.border}`,
                                        fontSize: 13,
                                        alignItems: "center",
                                        cursor: "pointer",
                                        background: bg,
                                        color: T.rowFg,
                                        height: TABLE_ROW_PX,
                                        lineHeight: `${TABLE_ROW_PX - 10}px`,
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

                        {/* Padding rows up to TABLE_ROW_COUNT */}
                        {songs.length < TABLE_ROW_COUNT && Array.from({ length: TABLE_ROW_COUNT - songs.length }).map((_, i) => {
                            const idx = songs.length + i;
                            const bg = (idx % 2 === 0) ? T.rowEven : T.rowOdd;
                            return (
                                <div
                                    key={`pad-${i}`}
                                    aria-hidden="true"
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: GRID_COLS,
                                        padding: "8px 10px",
                                        borderBottom: `1px solid ${T.border}`,
                                        fontSize: 13,
                                        alignItems: "center",
                                        background: bg,
                                        color: T.rowFg,
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
            </section>

            {/* ===== EDIT PANEL (ALWAYS VISIBLE, BELOW GRID) ===== */}
            <section aria-label="Edit panel" style={{ marginTop: 8, background: "transparent" }}>
                <div
                    id="edit-card"
                    key={isDark ? "dark" : "light"}  // force remount when theme flips
                    data-theme={isDark ? "dark" : "light"}
                    style={{
                        padding: 16,
                        border: `1px solid ${T.border}`,
                        borderRadius: 8,
                        background: T.bgCard,
                        backgroundColor: T.bgCard,
                        color: T.fgCard,
                    }}
                >
                    <div
                        style={{
                            marginTop: 0,
                            display: "grid",
                            gridTemplateColumns: "120px 1fr",
                            rowGap: 10,
                            columnGap: 12,
                            background: "transparent",
                        }}
                    >
                        <label style={{ alignSelf: "center", fontWeight: 600 }}>Song Title</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => { setTitle(e.target.value); }}
                            style={fieldCss}
                        />

                        <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <input
                                type="text"
                                value={composerFirst}
                                onChange={(e) => { setComposerFirst(e.target.value); }}
                                placeholder="First"
                                style={fieldCss}
                            />
                            <input
                                type="text"
                                value={composerLast}
                                onChange={(e) => { setComposerLast(e.target.value); }}
                                placeholder="Last"
                                style={fieldCss}
                            />
                        </div>

                        <label style={{ alignSelf: "center", fontWeight: 600 }}>Skill Level</label>
                        <select
                            value={level}
                            onChange={(e) => { setLevel(e.target.value); }}
                            disabled={levelsLoading || !!levelsError || levels.length === 0}
                            style={{ ...fieldCss, appearance: "auto" as const }}
                        >
                            <option value="" disabled>— Select a level —</option>
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
                        <input type="text" value={fileName} readOnly style={fieldCss} />

                        <label style={{ alignSelf: "start", fontWeight: 600, paddingTop: 6 }}>MusicXML</label>
                        <textarea
                            aria-label="XML"
                            value={xmlPreview}
                            onChange={(e) => { setXmlPreview(e.target.value); }}
                            spellCheck={false}
                            style={{
                                ...fieldCss,
                                width: "100%",
                                margin: 0,
                                minHeight: XML_PREVIEW_HEIGHT,
                                maxHeight: XML_PREVIEW_HEIGHT,
                                overflow: "auto",
                                resize: "vertical",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                fontSize: 13,
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
                        {/* Hidden file input lives inside the card */}
                        <input
                            ref={fileInputRef}
                            id="song-file-input"
                            type="file"
                            accept=".mxl,.musicxml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,application/zip"
                            onChange={onPick}
                            style={{ display: "none" }}
                        />

                        {/* Left-side button: Load */}
                        <button
                            type="button"
                            onClick={() => { if (fileInputRef.current) { fileInputRef.current.click(); } }}
                            style={{
                                padding: "8px 12px",
                                border: `1px solid ${T.border}`,
                                borderRadius: 6,
                                background: isDark ? "#1f1f1f" : "#fafafa",
                                color: isDark ? "#fff" : "#111",
                                cursor: "pointer",
                            }}
                        >
                            Load New Song
                        </button>

                        {/* Middle: status message fills available space */}
                        <span
                            key={`status-${statusTick}`}
                            aria-live="polite"
                            role={parsing ? "status" : (error ? "alert" : saveOk ? "status" : undefined)}
                            title={parsing ? "Parsing…" : (error || saveOk || "")}
                            style={{
                                flex: 1,
                                minWidth: 0,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                textAlign: "right",
                                color: parsing ? (isDark ? "#ccc" : "#555") : (error ? "#ff6b6b" : T.headerFg),
                                fontWeight: 500,
                                margin: 0,
                                visibility: (parsing || error || saveOk) ? "visible" : "hidden",
                            }}
                        >
                            {parsing ? "Parsing…" : (error || saveOk || "")}
                        </span>

                        {/* Right-side buttons: Save then View */}
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={!canSave}
                            style={{
                                padding: "8px 12px",
                                border: `1px solid ${T.border}`,
                                borderRadius: 6,
                                background: isDark ? "#1f1f1f" : "#fafafa",
                                color: isDark ? "#fff" : "#111",
                                cursor: canSave ? "pointer" : "not-allowed",
                                opacity: canSave ? 1 : 0.5,
                            }}
                        >
                            {saveLabel}
                        </button>

                        <button
                            type="button"
                            onClick={openViewer}
                            disabled={!canView}
                            style={{
                                padding: "8px 12px",
                                border: `1px solid ${T.border}`,
                                borderRadius: 6,
                                background: isDark ? "#1f1f1f" : "#fafafa",
                                color: isDark ? "#fff" : "#111",
                                cursor: canView ? "pointer" : "not-allowed",
                                opacity: canView ? 1 : 0.5,
                            }}
                        >
                            View Song
                        </button>
                    </div>
                </div>
            </section>

            {/* Scoped guardrails against stray global CSS (no `any`) */}
            <style jsx global>{`
  /* Edit card: win even against global .card {...}!important */
  #edit-card {
    background: ${T.bgCard} !important;
    color: ${T.fgCard} !important;
    border: 1px solid ${T.border} !important;
    border-radius: 8px !important;
    padding: 16px !important;
  }

  /* Inputs inside the edit card stay readable in dark mode */
  #edit-card input,
  #edit-card select,
  #edit-card textarea {
    background: ${isDark ? "#121212" : "#ffffff"} !important;
    color: ${isDark ? "#ffffff" : "#111111"} !important;
    border: 1px solid ${T.border} !important;
  }

  /* ---- Songs table header (ensure dark bg/fg) ---- */
  #songs-header {
    background: ${T.headerBg} !important;
    color: ${T.headerFg} !important;
  }

  /* Ensure header buttons/text use header fg color */
  #songs-header button,
  #songs-header * {
    color: ${T.headerFg} !important;
  }
`}
            </style>
        </main>
    );
}
