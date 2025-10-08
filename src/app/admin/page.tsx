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

export default function AdminPage() {
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [saveOk, setSaveOk] = React.useState("");

    // fields
    const [title, setTitle] = React.useState("");
    const [composerFirst, setComposerFirst] = React.useState("");
    const [composerLast, setComposerLast] = React.useState("");
    const [level, setLevel] = React.useState(""); // ← starts blank, must be chosen
    const [levels, setLevels] = React.useState<string[]>([]);
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
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const json: { levels?: string[] } = await res.json();
                if (!cancelled) {
                    setLevels(Array.isArray(json.levels) ? json.levels : []);
                    // intentionally do NOT call setLevel(...) here — leave it blank
                }
            } catch (e) {
                if (!cancelled) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setLevelsError(msg);
                }
            } finally {
                if (!cancelled) { setLevelsLoading(false); }
            }
        }

        void loadLevels();
        return () => { cancelled = true; };
    }, []);

    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setSaveOk("");
        setParsing(false);
        setTitle("");
        setComposerFirst("");
        setComposerLast("");
        setLevel("");              // ← force a fresh selection for each file
        setFileName("");
        setXmlPreview("");

        const f = e.target.files?.[0] ?? null;
        if (!f) { setFile(null); return; }

        const lower = (f.name || "").toLowerCase();
        const isMxl = lower.endsWith(".mxl");
        const isXml = lower.endsWith(".musicxml");
        if (!isMxl && !isXml) { setError("Please select a .mxl or .musicxml file."); setFile(null); return; }

        setFile(f);
        setFileName(f.name);
        setParsing(true);

        try {
            const meta = await extractMetadataAndXml(f, { isMxl, isXml });
            setTitle(meta.title || "");
            setComposerFirst(meta.composer || "");
            setComposerLast("");

            const preview = xmlUpToDefaultsOrFirstLines(meta.xmlText || "", 25);
            setXmlPreview(preview);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setParsing(false);
        }
    };

    // ---- client-side string checks ----
    function hasLeadingSpace(s: string): boolean { return s.length > 0 && s[0] === " "; }
    function hasDoubleSpace(s: string): boolean { return s.includes("  "); }
    function rtrimSpaces(s: string): string { return s.replace(/[ \t]+$/u, ""); }
    function isInLevels(val: string): boolean { return levels.includes(val); }

    const onSave = async (): Promise<void> => {
        setError("");
        setSaveOk("");

        if (!file) { setError("No file selected."); return; }

        const titleTrimmed = rtrimSpaces(title);
        const firstTrimmed = rtrimSpaces(composerFirst);
        const lastTrimmed = rtrimSpaces(composerLast);

        // Required: title and explicit level selection (no default)
        if (titleTrimmed.length === 0) { setError("Title is required."); return; }
        if (level.length === 0) { setError("Skill level is required."); return; }
        if (!isInLevels(level)) { setError("Skill level value is not in the list."); return; }

        // Leading / double-space rules
        if (hasLeadingSpace(titleTrimmed)) { setError("Title must not start with a space."); return; }
        if (hasDoubleSpace(titleTrimmed)) { setError("Title must not contain double spaces."); return; }

        if (firstTrimmed.length > 0) {
            if (hasLeadingSpace(firstTrimmed)) { setError("Composer first name must not start with a space."); return; }
            if (hasDoubleSpace(firstTrimmed)) { setError("Composer first name must not contain double spaces."); return; }
        }
        if (lastTrimmed.length > 0) {
            if (hasLeadingSpace(lastTrimmed)) { setError("Composer last name must not start with a space."); return; }
            if (hasDoubleSpace(lastTrimmed)) { setError("Composer last name must not contain double spaces."); return; }
        }

        try {
            setSaving(true);

            const bytes = new Uint8Array(await file.arrayBuffer());
            const base64 = bytesToBase64(bytes);

            const payload = {
                song_title: titleTrimmed,
                composer_first_name: firstTrimmed,
                composer_last_name: lastTrimmed,
                skill_level_name: level,
                file_name: fileName || file.name,
                song_mxl_base64: base64,
            };

            const res = await fetch(SAVE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            let json: SaveResponse | null = null;
            const ct = res.headers.get("content-type") ?? "";
            if (ct.includes("application/json")) { json = (await res.json()) as SaveResponse; }

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

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            {/* Top bar: Load button */}
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <input
                    ref={fileInputRef}
                    id="song-file-input"
                    type="file"
                    accept=".mxl,.musicxml,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,application/zip"
                    onChange={onPick}
                    style={{ display: "none" }}
                />

                <button
                    type="button"
                    onClick={() => { if (fileInputRef.current) { fileInputRef.current.click(); } }}
                    style={{
                        padding: "8px 12px",
                        border: "1px solid #aaa",
                        borderRadius: 6,
                        background: "#fafafa",
                        cursor: "pointer",
                        marginLeft: "auto",
                        color: "#111",
                    }}
                >
                    Load a File
                </button>

                {parsing && (<span aria-live="polite" style={{ alignSelf: "center" }}>Parsing…</span>)}
            </div>

            {/* Card only after a file is selected */}
            {file && (
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
                                onChange={(e) => { setTitle(e.target.value); }}
                                style={roStyle}
                            />

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <input
                                    type="text"
                                    value={composerFirst}
                                    onChange={(e) => { setComposerFirst(e.target.value); }}
                                    placeholder="First"
                                    style={roStyle}
                                />
                                <input
                                    type="text"
                                    value={composerLast}
                                    onChange={(e) => { setComposerLast(e.target.value); }}
                                    placeholder="Last"
                                    style={roStyle}
                                />
                            </div>

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Skill Level</label>
                            <select
                                value={level}
                                onChange={(e) => { setLevel(e.target.value); }}
                                disabled={levelsLoading || !!levelsError || levels.length === 0}
                                style={{ ...roStyle, appearance: "auto" as const }}
                            >
                                {/* disabled placeholder so the field starts blank */}
                                <option value="" disabled>
                                    — Select a level —
                                </option>
                                {levels.map((l) => {
                                    return (
                                        <option key={l} value={l}>{l}</option>
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
                                onChange={(e) => { setXmlPreview(e.target.value); }}
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
                                    // fills the left side; button stays pinned right
                                    flex: 1,
                                    minWidth: 0,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    textAlign: "right",      // ← right-justify message text
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
                                    marginLeft: "auto", // keeps the button pinned right
                                }}
                            >
                                {saving ? "Saving…" : "Save to Database"}
                            </button>
                        </div>
                    </div>
                </section>
            )}
        </main>
    );
}

const roStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #ccc",
    borderRadius: 6,
    background: "#fdfdfd",
    color: "#111",
};


// --- helpers (unchanged) ---

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
        if (!container) { throw new Error("MXL: META-INF/container.xml missing"); }
        const containerXml = await container.text();
        const rootPath = findRootfilePath(containerXml);
        const root = entries[rootPath];
        if (!root) { throw new Error(`MXL: rootfile missing in archive: ${rootPath}`); }
        const xmlText = await root.text();
        const meta = extractFromMusicXml(xmlText, file.name);
        return { ...meta, xmlText };
    }
    throw new Error("Unsupported file type");
}

function findRootfilePath(containerXml: string): string {
    const doc = new DOMParser().parseFromString(containerXml, "application/xml");
    const el = doc.querySelector("rootfile[full-path], rootfile[path], rootfile[href]");
    const p =
        el?.getAttribute("full-path") ||
        el?.getAttribute("path") ||
        el?.getAttribute("href") ||
        "";
    if (!p) { throw new Error("MXL: container rootfile path missing"); }
    return p;
}

function extractFromMusicXml(xmlText: string, fallbackName: string): { title: string; composer: string } {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) { throw new Error("Invalid MusicXML (parsererror)"); }

    const songTitle = firstText(doc, "song > song-title");
    const movementTitle = firstText(doc, "movement-title");
    const creditWords = firstText(doc, "credit > credit-words");
    const title = firstNonEmpty(songTitle, movementTitle, creditWords, stripExt(fallbackName));

    const composerTyped = firstText(doc, 'identification > creator[type="composer"]');
    const anyCreator = firstText(doc, "identification > creator");
    const composer = firstNonEmpty(composerTyped, anyCreator, "");

    return { title, composer };
}

function firstText(doc: Document, selector: string): string {
    const el = doc.querySelector(selector);
    const raw = el?.textContent ?? "";
    return collapseWs(raw);
}

function firstNonEmpty(...vals: (string | undefined)[]): string {
    for (const v of vals) { if (v && v.trim()) { return v.trim(); } }
    return "";
}

function stripExt(name: string): string {
    const lower = (name || "").toLowerCase();
    if (lower.endsWith(".musicxml")) { return name.slice(0, -10); }
    if (lower.endsWith(".mxl")) { return name.slice(0, -4); }
    return name;
}

function collapseWs(s: string): string {
    let out = "";
    let inWs = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const ws = ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
        if (ws) {
            if (!inWs) { out += " "; inWs = true; }
        } else {
            out += ch; inWs = false;
        }
    }
    return out.trim();
}

function xmlUpToDefaultsOrFirstLines(xmlText: string, n: number): string {
    const endTag = "</defaults>";
    const idx = xmlText.indexOf(endTag);
    if (idx >= 0) {
        const cut = idx + endTag.length;
        return xmlText.slice(0, cut);
    }
    const lines = xmlText.split(/\r?\n/);
    const head = lines.slice(0, Math.max(0, n));
    return head.join("\n") + (lines.length > head.length ? "\n…" : "");
}

function bytesToBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]!);
    }
    return btoa(s);
}
