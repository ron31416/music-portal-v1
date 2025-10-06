"use client";

import React from "react";

// /admin — pick one file, parse metadata, display Title/Composer/Level (read-only)
export default function AdminPage() {
    const [file, setFile] = React.useState<File | null>(null);
    const [parsing, setParsing] = React.useState(false);
    const [error, setError] = React.useState("");

    // display-only fields for now
    const [title, setTitle] = React.useState("");
    const [composer, setComposer] = React.useState("");
    const [level, setLevel] = React.useState(""); // chosen later; display-only now

    const clear = () => {
        setFile(null);
        setParsing(false);
        setError("");
        setTitle("");
        setComposer("");
        setLevel("");
        const input = document.getElementById("song-file-input") as HTMLInputElement | null;
        if (input) { input.value = ""; }
    };

    const onPick: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
        setError("");
        setParsing(false);
        setTitle("");
        setComposer("");
        setLevel("");

        const f = e.target.files?.[0] ?? null;
        if (!f) { setFile(null); return; }

        // Accept only .mxl or .musicxml by extension (MIME is unreliable)
        const lower = (f.name || "").toLowerCase();
        const isMxl = lower.endsWith(".mxl");
        const isXml = lower.endsWith(".musicxml");
        if (!isMxl && !isXml) { setError("Please select a .mxl or .musicxml file."); setFile(null); return; }

        setFile(f);
        setParsing(true);

        try {
            const meta = await extractMetadataFromFile(f, { isMxl, isXml });
            setTitle(meta.title || "");
            setComposer(meta.composer || "");
            setLevel(""); // display-only for now
        } catch (err) {
            if (err instanceof Error) { setError(err.message); }
            else { setError(String(err)); }
        } finally {
            setParsing(false);
        }
    };

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            <h1 style={{ marginBottom: 8 }}>Admin</h1>
            <p style={{ color: "#666", marginBottom: 24 }}>
                Single-file song import — pick a file, then review parsed fields (read-only).
            </p>

            <section aria-labelledby="add-song-h">
                <h2 id="add-song-h" style={{ marginBottom: 12 }}>Add song</h2>

                <div style={{ padding: 16, border: "1px solid #ddd", borderRadius: 8, background: "#fafafa" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <label htmlFor="song-file-input" style={{ fontWeight: 600 }}>Select file:</label>
                        <input
                            id="song-file-input"
                            type="file"
                            accept=".mxl,.musicxml,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,application/zip"
                            onChange={onPick}
                        />
                        {file && (
                            <button
                                type="button"
                                onClick={clear}
                                style={{ padding: "6px 10px", border: "1px solid #ccc", borderRadius: 6, background: "#fff", cursor: "pointer" }}
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    {error && (
                        <p role="alert" style={{ color: "#b00020", marginTop: 12 }}>{error}</p>
                    )}

                    {file && (
                        <div style={{ marginTop: 14, fontSize: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <strong>Selected:</strong>
                                <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" }}>{file.name}</span>
                                <span style={{ padding: "2px 6px", borderRadius: 6, border: "1px solid #ccc", background: "#fff" }}>
                                    {file.name.toLowerCase().endsWith(".mxl") ? "MXL" : "MusicXML"}
                                </span>
                                {parsing && (<span aria-live="polite">Parsing…</span>)}
                            </div>
                            <div>
                                Size: {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(file.size / 1024)} KB
                            </div>
                        </div>
                    )}

                    {/* Display-only boxes */}
                    {file && (
                        <div style={{
                            marginTop: 18,
                            display: "grid",
                            gridTemplateColumns: "120px 1fr",
                            rowGap: 10,
                            columnGap: 12,
                        }}>
                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Title</label>
                            <input type="text" value={title} readOnly style={roStyle} />

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                            <input type="text" value={composer} readOnly style={roStyle} />

                            <label style={{ alignSelf: "center", fontWeight: 600 }}>Level</label>
                            <input type="text" value={level} readOnly placeholder="(choose later)" style={roStyle} />
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

// --- tiny helpers ---

async function extractMetadataFromFile(
    file: File,
    kind: { isMxl: boolean; isXml: boolean }
): Promise<{ title: string; composer: string }> {
    if (kind.isXml) {
        const xmlText = await file.text();
        return extractFromMusicXml(xmlText, file.name);
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
        return extractFromMusicXml(xmlText, file.name);
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
    const raw = el?.textContent ?? "";  // if el is null OR textContent is null → ""
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
    // Replace any run of whitespace with a single space, then trim
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
