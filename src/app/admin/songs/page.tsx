// src/app/admin/songs/page.tsx
"use client";

import React from "react";

import { usePrefersDark, themeTokens, fieldStyle } from "@/lib/theme";
import AdminSongListPanel from "@/components/AdminSongListPanel";
import AdminSongEditPanel from "@/components/AdminSongEditPanel";
import type { SongListItem } from "@/lib/types";
import { SONG_COL, type SongColToken, DEFAULT_SORT, DEFAULT_DIR } from "@/lib/songCols";
import { fetchSongList } from "@/lib/songListFetch";


// --- Config ---

//                  First Last Title Level File
const GRID_COLS_PX = [140, 140, 260, 100, 440] as const;
const GRID_COLS: React.CSSProperties["gridTemplateColumns"] = GRID_COLS_PX.map(n => `${n}px`).join(" ");
const TABLE_MIN_PX = GRID_COLS_PX.reduce((a, b) => a + b, 0);
const TABLE_ROW_PX = 28;
const TABLE_ROW_COUNT = 10;

const SONG_LIST_ENDPOINT = "/api/songlist";
const SAVE_ENDPOINT = "/api/song";
const XML_PREVIEW_HEIGHT = 200;


// --- Types ---

type SaveResponse = {
    ok?: boolean;
    song_id?: number;
    error?: string;
    message?: string;
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

// --- Component ---

export default function AdminSongsPage(): React.ReactElement {
    // File / edit state
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [saveOk, setSaveOk] = React.useState("");
    const [deleting, setDeleting] = React.useState(false);

    // Song list state (inline, always visible)
    const [rows, setRows] = React.useState<SongListItem[]>([]);
    const [listLoading, setListLoading] = React.useState(false);
    const [listError, setListError] = React.useState("");

    // Server sorting only
    const [sort, setSort] = React.useState<SongColToken | null>(DEFAULT_SORT);
    const [sortDir, setSortDir] = React.useState<SortDir>(DEFAULT_DIR);

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
    const [xmlLoading, setXmlLoading] = React.useState(false);

    const [songId, setSongId] = React.useState<number | null>(null);

    const [statusTick, setStatusTick] = React.useState(0);

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const listAbortRef = React.useRef<AbortController | null>(null);
    const listSeqRef = React.useRef(0);
    const mxlAbortRef = React.useRef<AbortController | null>(null);
    const mxlSeqRef = React.useRef(0);

    const isDark = usePrefersDark();
    const T = React.useMemo(() => themeTokens(isDark), [isDark]);        // memoize tokens

    const fieldCss = React.useMemo(() => fieldStyle(isDark), [isDark]);

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

        // cancel any in-flight request
        if (listAbortRef.current !== null) {
            listAbortRef.current.abort();
        }

        // set up new request + sequence
        const controller = new AbortController();
        listAbortRef.current = controller;
        const seq = listSeqRef.current + 1;
        listSeqRef.current = seq;

        try {
            const effSort = overrideSort ?? sort;
            const effDir: SortDir = overrideDir ?? sortDir;

            // shared fetch + normalize
            const data = await fetchSongList(
                SONG_LIST_ENDPOINT,
                effSort,            // SongColToken | null → string | null OK
                effDir,             // "asc" | "desc"
                controller.signal
            );

            // ignore stale responses
            if (seq !== listSeqRef.current) {
                return;
            }

            // set table rows
            setRows(data);

            // rebuild duplicate-check map (file_name → song_id)
            const m = new Map<string, number>();
            for (const row of data) {
                if (row.file_name) {
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

        let seq = 0;
        try {
            setError("");
            setSaveOk("");
            setSongId(item.song_id);

            setFile(null);
            setXmlPreview("");
            setXmlLoading(true);

            if (mxlAbortRef.current !== null) {
                mxlAbortRef.current.abort();
            }

            const controller = new AbortController();
            mxlAbortRef.current = controller;
            seq = mxlSeqRef.current + 1;
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
                return; // ignore stale (xmlLoading will be cleared by the latest call)
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

            // mark loading complete if this is the latest request
            if (mxlSeqRef.current === seq) {
                setXmlLoading(false);
            }
        } catch (e: unknown) {
            const name = (e as { name?: string } | null)?.name ?? "";
            if (name === "AbortError") {
                // do NOT clear here; a newer request is in flight and will clear
                return;
            }
            setError(e instanceof Error ? e.message : String(e));

            // on real error, clear loading only if this is still the latest request
            if (mxlSeqRef.current === seq) {
                setXmlLoading(false);
            }
        }
    };

    const openViewer = React.useCallback(() => {
        if (songId !== null) {
            const tabId = Date.now().toString(36);
            window.open(`/viewer?tab=${tabId}&id=${songId}`, "_blank", "noopener,noreferrer");
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

    const onDelete = async (): Promise<void> => {
        setError("");
        setSaveOk("");

        if (songId === null) {
            setError("No song selected.");
            return;
        }

        const confirmed = window.confirm("Delete this song? This cannot be undone.");
        if (!confirmed) { return; }

        try {
            setDeleting(true);

            // Abort any in-flight XML fetch for this song
            if (mxlAbortRef.current !== null) {
                mxlAbortRef.current.abort();
            }

            const res = await fetch(`/api/song?id=${songId}`, { method: "DELETE" });
            if (!res.ok) {
                const ct = res.headers.get("content-type") ?? "";
                let detail = `HTTP ${res.status}`;

                if (ct.includes("application/json")) {
                    try {
                        const j = await res.json();
                        const msg = (j && typeof j === "object" ? (j as Record<string, unknown>).message : "") as unknown;
                        if (typeof msg === "string" && msg.trim()) { detail = msg; }
                    } catch { /* ignore */ }
                } else if (ct.startsWith("text/")) {
                    try {
                        const t = await res.text();
                        if (t) { detail = t.slice(0, 200); }
                    } catch { /* ignore */ }
                }

                setError(detail || "Delete failed.");
                return;
            }

            // Success: clear form & input
            setSongId(null);
            setTitle("");
            setComposerFirst("");
            setComposerLast("");
            setLevel("");
            setFileName("");
            setXmlPreview("");
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }

            // Silent list refresh (also rebuilds dup map)
            await refreshSongList(undefined, undefined, false);

            // Feedback
            setError("");
            setSaveOk("Deleted");
            setStatusTick((t) => t + 1);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setDeleting(false);
        }
    };


    const isUpdate = songId !== null;
    const canAdd = !isUpdate && !!fileName && !parsing && !saving;
    const canUpdate = isUpdate && !saving && !xmlLoading;
    const canSave = isUpdate ? canUpdate : canAdd;
    const saveLabel = isUpdate ? "Update Song" : "Add Song";
    const canView = songId !== null && !xmlLoading;
    const canDelete = songId !== null && !saving && !xmlLoading && !parsing && !deleting;

    return (
        <main style={{ maxWidth: TABLE_MIN_PX + 32, margin: "24px auto", padding: "0 16px" }}>
            {/* ===== SONG LIST (TOP) ===== */}
            <AdminSongListPanel
                rows={rows}
                listLoading={listLoading}
                listError={listError}
                sort={sort}
                sortDir={sortDir}
                onToggleSort={toggleSort}
                onRowClick={(row) => { void loadSongRow(row); }}
                gridCols={GRID_COLS}
                tableMinPx={TABLE_MIN_PX}
                rowPx={TABLE_ROW_PX}
                visibleRowCount={TABLE_ROW_COUNT}
                T={T}
            />

            {/* ===== EDIT PANEL (ALWAYS VISIBLE, BELOW GRID) ===== */}
            <AdminSongEditPanel
                /* controlled values */
                title={title}
                composerFirst={composerFirst}
                composerLast={composerLast}
                level={level}
                levels={levels}
                levelsLoading={levelsLoading}
                levelsError={levelsError}
                fileName={fileName}
                xml={xmlPreview}
                xmlLoading={xmlLoading}
                parsing={parsing}
                errorText={error}
                saveOkText={saveOk}
                statusTick={statusTick}

                /* computed enables/labels */
                canSave={canSave}
                saveLabel={saveLabel}
                canView={canView}
                canDelete={canDelete}
                deleting={deleting}
                onDelete={onDelete}


                /* handlers */
                onChangeTitle={(v) => { setTitle(v); }}
                onChangeComposerFirst={(v) => { setComposerFirst(v); }}
                onChangeComposerLast={(v) => { setComposerLast(v); }}
                onChangeLevel={(v) => { setLevel(v); }}
                onChangeXml={(v) => { setXmlPreview(v); }}
                onPick={onPick}
                onSave={onSave}
                onOpenViewer={openViewer}

                /* refs */
                fileInputRef={fileInputRef}

                /* theming/layout */
                T={T}
                fieldCss={fieldCss}
                isDark={isDark}
                xmlPreviewHeight={XML_PREVIEW_HEIGHT}
            />

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
