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
    const [composer, setComposer] = React.useState("");
    const [level, setLevel] = React.useState("");

    const [xmlPreview, setXmlPreview] = React.useState(""); // start→</defaults> (or first 25 lines)
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setSaveOk("");
        setParsing(false);
        setTitle("");
        setComposer("");
        setLevel("");
        setXmlPreview("");

        const f = e.target.files?.[0] ?? null;
        if (!f) { setFile(null); return; }

        const lower = (f.name || "").toLowerCase();
        const isMxl = lower.endsWith(".mxl");
        const isXml = lower.endsWith(".musicxml");
        if (!isMxl && !isXml) { setError("Please select a .mxl or .musicxml file."); setFile(null); return; }

        setFile(f);
        setParsing(true);

        try {
            const meta = await extractMetadataAndXml(f, { isMxl, isXml });
            setTitle(meta.title || "");
            setComposer(meta.composer || "");

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
                ComposerName: composer || "(unknown)",
                SongTitle: title || stripExt(file.name),
                SongLevel: "Intermediate I", // one of: Beginner I/II, Intermediate I/II, Advanced
                FileName: file.name,
                Mime:
                    file.type ||
                    (file.name.toLowerCase().endsWith(".mxl")
                        ? "application/vnd.recordare.musicxml"
                        : "application/vnd.recordare.musicxml+xml"),
                SongMxlBase64: base64,
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
            <h1 style={{ marginBottom: 8 }}>Admin</h1>
            <p style={{ color: "#666", marginBottom: 24 }}>
                Single-file song import — pick a file, then review parsed fields. Title/Composer are read-only for now.
            </p>

            <section aria-labelledby="add-song-h">
                <h2 id="add-song-h" style={{ marginBottom: 12 }}>Add song</h2>

                {/* White card with dark text for readability on dark themes */}
                <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fff", color: "#000" }}>
                    {/* File picker row */}
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flexWrap: "wrap",
                            justifyContent: "space-between",
                        }}
                    >
                        {/* Hidden real input (to avoid native truncated filename UI) */}
                        <input
                            ref={fileInputRef}
                            id="song-file-input"
                            type="file"
                            accept=".mxl,.musicxml,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,application/zip"
                            onChange={onPick}
                            style={{ display: "none" }}
                        />

                        {/* Right side: button that triggers hidden input */}
                        <button
                            type="button"
                            onClick={() => { if (fileInputRef.current) { fileInputRef.current.click(); } }}
                            style={{
                                padding: "8px 12px",
                                border: "1px solid #aaa",
                                borderRadius: 6,
                                background: "#fafafa",
                                cursor: "pointer",
                            }}
                        >
                            Choose File
                        </button>

                        {parsing && (<span aria-live="polite">Parsing…</span>)}
                    </div>

                    {file && (
                        <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "flex-end" }}>
                        </div>
                    )}

                    {(error || saveOk) && (
                        <p role={error ? "alert" : undefined} style={{ color: error ? "#b00020" : "#08660b", marginTop: 12 }}>
                            {error || saveOk}
                        </p>
                    )}

                    {/* Fields */}
                    {file && (
                        <div
                            style={{
                                marginTop: 18,
                                display: "grid",
                                gridTemplateColumns: "120px 1fr",
                                rowGap: 10,
                                columnGap: 12,
                            }}
                        >
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Title</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => { setTitle(e.target.value); }}
                                style={roStyle}
                            />
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                            <input
                                type="text"
                                value={composer}
                                onChange={(e) => { setComposer(e.target.value); }}
                                style={roStyle}
                            />
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Level</label>
                            <input
                                type="text"
                                value={level}
                                onChange={(e) => { setLevel(e.target.value); }}
                                style={roStyle}
                            />

                            <label style={{ alignSelf: "start", fontWeight: 600, paddingTop: 6 }}>XML</label>

                            <pre
                                aria-label="XML preview"
                                style={{
                                    margin: 0,
                                    whiteSpace: "pre-wrap",
                                    background: "#fff",
                                    border: "1px solid #ccc",
                                    borderRadius: 6,
                                    padding: "8px 10px",
                                    maxHeight: "300px",
                                    overflow: "auto",
                                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                    fontSize: 13,
                                    color: "#000",
                                }}
                            >
                                {xmlPreview || "(no XML found)"}
                            </pre>
                        </div>
                    )}

                    {/* Actions */}
                    {file && (
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
                                }}
                            >
                                {saving ? "Saving…" : "Save"}
                            </button>
                        </div>
                    )}
                </div>
            </section>
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
