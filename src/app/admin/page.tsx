/* eslint curly: ["error", "all"] */
"use client";

import React from "react";
import Link from "next/link";

export default function AdminPage() {
    const [file, setFile] = React.useState<File | null>(null);
    const [error, setError] = React.useState<string>("");

    const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
        setError("");
        const f = e.target.files?.[0] ?? null;
        if (!f) {
            setFile(null);
            return;
        }

        // Basic type/extension guard; we allow .mxl and .musicxml
        const okExt = /\.(mxl|musicxml)$/i.test(f.name);
        const okMime = (
            f.type === "application/vnd.recordare.musicxml" ||
            f.type === "application/vnd.recordare.musicxml+xml" ||
            f.type === "application/zip" ||
            f.type === "application/x-zip-compressed" ||
            f.type === ""
        );

        if (!okExt && !okMime) {
            setError("Please select a .mxl or .musicxml file.");
            setFile(null);
            return;
        }

        setFile(f);
    };

    const clear = () => {
        setFile(null);
        setError("");
        // Also clear the hidden input's value so the same file can be re-picked
        const input = document.getElementById("song-file-input") as HTMLInputElement | null;
        if (input) { input.value = ""; }
    };

    return (
        <main style={{ maxWidth: 860, margin: "40px auto", padding: "0 16px" }}>
            <h1 style={{ marginBottom: 8 }}>Admin</h1>
            <p style={{ color: "#666", marginBottom: 24 }}>Single-file song import (step 1: pick a file).</p>

            <section aria-labelledby="add-song-h">
                <h2 id="add-song-h" style={{ marginBottom: 12 }}>Add song</h2>

                <div style={{
                    padding: 16,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    background: "#fafafa",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        <label htmlFor="song-file-input" style={{ fontWeight: 600 }}>Select file:</label>
                        <input
                            id="song-file-input"
                            type="file"
                            accept=".mxl,.musicxml,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml,application/zip"
                            onChange={onPick}
                        />
                        {file && (
                            <button type="button" onClick={clear} style={{
                                padding: "6px 10px",
                                border: "1px solid #ccc",
                                borderRadius: 6,
                                background: "white",
                                cursor: "pointer"
                            }}>Clear</button>
                        )}
                    </div>

                    {error && (
                        <p role="alert" style={{ color: "#b00020", marginTop: 12 }}>{error}</p>
                    )}

                    {file && (
                        <div style={{ marginTop: 14, fontSize: 14 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                <strong>Selected:</strong>
                                <span>{file.name}</span>
                                <span style={{
                                    padding: "2px 6px",
                                    borderRadius: 6,
                                    border: "1px solid #ccc",
                                    background: "#fff"
                                }}>
                                    {/\.mxl$/i.test(file.name) ? "MXL" : /\.musicxml$/i.test(file.name) ? "MusicXML" : "Unknown"}
                                </span>
                            </div>
                            <div>
                                Size: {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(file.size / 1024)} KB
                            </div>
                        </div>
                    )}

                    {/* Next steps (later): parse metadata → editable fields → save to DB */}
                </div>
            </section>

            <p style={{ marginTop: 24 }}>
                <Link href="/">← Back to home</Link>
            </p>
        </main>
    );
}
