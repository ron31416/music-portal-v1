"use client";

import React from "react";

// --- Config: change if your API route differs ---
const SAVE_ENDPOINT = "/api/songs"; // expects JSON payload below

export default function AdminPage() {
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");
    const [saving, setSaving] = React.useState(false);
    const [saveOk, setSaveOk] = React.useState("");

    // display-only fields for now
    const [title, setTitle] = React.useState("");
    const [composerFirst, setComposerFirst] = React.useState("");
    const [composerLast, setComposerLast] = React.useState("");
    const [level, setLevel] = React.useState("");
    const [levels, setLevels] = React.useState<string[]>([]);
    const [levelsLoading, setLevelsLoading] = React.useState(false);
    const [levelsError, setLevelsError] = React.useState("");
    const [fileName, setFileName] = React.useState("");
    const [xmlPreview, setXmlPreview] = React.useState(""); // start→</defaults> (or first 25 lines)

    const fileInputRef = React.useRef<HTMLInputElement>(null);
    // fetch skill levels once on mount
    React.useEffect(() => {
        let cancelled = false;

        async function loadLevels() {
            try {
                setLevelsLoading(true);
                setLevelsError("");
                const res = await fetch("/api/skill-levels", { cache: "no-store" });
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const json: { levels?: string[] } = await res.json();
                const arr = Array.isArray(json.levels) ? json.levels : [];
                if (!cancelled) {
                    setLevels(arr);
                    // If no value chosen yet, default to the first level (or empty string)
                    setLevel(prev => prev || (arr[0] ?? ""));
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
    }, []); // run once


    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setSaveOk("");
        setParsing(false);
        setTitle("");
        setComposerFirst("");
        setComposerLast("");
        setLevel("");
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

            // Preview: up to and including </defaults>, else first 25 lines
            const preview = xmlUpToDefaultsOrFirstLines(meta.xmlText || "", 25);
            setXmlPreview(preview);
        } catch (err) {
            if (err instanceof Error) { setError(err.message); }
            else { setError(String(err)); }
        } finally {
            setParsing(false);
        }
    };

    const onSave = async () => {
        setError("");
        setSaveOk("");

        if (!file) { setError("No file selected."); return; }

        try {
            setSaving(true);

            // Raw bytes of the originally selected file (no modifications)
            const bytes = new Uint8Array(await file.arrayBuffer());
            const base64 = bytesToBase64(bytes);

            // Minimal payload — adjust field names to match your API if needed
            const payload = {
                work_title: title || stripExt(file.name),
                composer_first_name: composerFirst || "(unknown)",
                composer_last_name: composerLast || "",
                skill_level_name: level || "Intermediate",
                file_name: fileName || file.name,
                work_mxl_base64: base64,
            };

            const res = await fetch(SAVE_ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const text = await res.text();
                throw new Error(text || `Save failed (HTTP ${res.status})`);
            }

            setSaveOk("Saved ✓");
        } catch (err) {
            if (err instanceof Error) { setError(err.message); }
            else { setError(String(err)); }
        } finally {
            setSaving(false);
        }
    };

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            {/* Top bar: Load button only (upper-right). No headings/rectangle on first load */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
                {/* Hidden real input */}
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

                {parsing && (<span aria-live="polite" style={{ alignSelf: "center", marginLeft: 10 }}>Parsing…</span>)}
            </div>

            {/* Status line (below the button) */}
            {(error || saveOk) && (
                <p role={error ? "alert" : undefined} style={{ color: error ? "#b00020" : "#08660b", marginBottom: 12 }}>
                    {error || saveOk}
                </p>
            )}

            {/* Data card: only after a file is selected */}
            {file && (
                <section aria-labelledby="add-song-h">
                    {/* Keep the h2 for a11y but visually hide it */}
                    <h2
                        id="add-song-h"
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
                        Add song
                    </h2>

                    {/* White card with the fields + Save button */}
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
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Work Title</label>
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
                                    value={composerLast}
                                    onChange={(e) => { setComposerLast(e.target.value); }}
                                    placeholder="Last"
                                    style={roStyle}
                                />
                                <input
                                    type="text"
                                    value={composerFirst}
                                    onChange={(e) => { setComposerFirst(e.target.value); }}
                                    placeholder="First"
                                    style={roStyle}
                                />
                            </div>

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Skill Level</label>
                            <select
                                value={level}
                                onChange={(e) => { setLevel(e.target.value); }}
                                disabled={levelsLoading || !!levelsError || levels.length === 0}
                                style={{ ...roStyle, appearance: "auto" }}
                            >
                                {levels.map((l) => (
                                    <option key={l} value={l}>{l}</option>
                                ))}
                            </select>

                            {/* optional: show a small warning row if the fetch failed */}
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
                                    minHeight: 500,
                                    maxHeight: 500,
                                    overflow: "auto",
                                    resize: "vertical",
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                    fontSize: 13,
                                    color: "#000",
                                    lineHeight: 1.4,
                                }}
                            />
                        </div>

                        {/* Actions (Save stays inside the card, right-justified) */}
                        <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
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

// --- helpers ---

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

    // Title preference: work-title > movement-title > credit-words > filename(no ext)
    const workTitle = firstText(doc, "work > work-title");
    const movementTitle = firstText(doc, "movement-title");
    const creditWords = firstText(doc, "credit > credit-words");
    const title = firstNonEmpty(workTitle, movementTitle, creditWords, stripExt(fallbackName));

    // Composer: identification/creator[type="composer"] > creator > credit-words fallback
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
    // Collapse runs of whitespace to a single space, then trim.
    let out = "";
    let inWs = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        const ws = ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f";
        if (ws) {
            if (!inWs) { out += " "; inWs = true; }
        } else {
            out += ch;
            inWs = false;
        }
    }
    return out.trim();
}

// Show from start of XML through closing </defaults>; if not present, first N lines
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

// Utility: Uint8Array -> base64
function bytesToBase64(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i++) {
        s += String.fromCharCode(bytes[i]!);
    }
    return btoa(s);
}
