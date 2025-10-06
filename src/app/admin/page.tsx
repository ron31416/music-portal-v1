"use client";

import Link from "next/link";
import React from "react";

export default function AdminPage() {
    return (
        <main style={{ maxWidth: 960, margin: "40px auto", padding: "0 16px" }}>
            <h1 style={{ marginBottom: 4 }}>Admin</h1>
            <p style={{ color: "#666", marginBottom: 16 }}>
                Internal tools. Single-file song import and student management.
            </p>

            <nav aria-label="Admin sections" style={{ marginBottom: 20 }}>
                <a href="#add-song" style={{ marginRight: 16 }}>Add song</a>
                <a href="#students">Students</a>
            </nav>

            <section id="add-song" aria-labelledby="add-song-h" style={{ marginBottom: 32 }}>
                <h2 id="add-song-h" style={{ marginBottom: 8 }}>Add song</h2>
                <div style={{
                    padding: 16,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    background: "#fafafa"
                }}>
                    {/* Next step: file input + fields go here */}
                    <p style={{ margin: 0 }}>Upload form will go here (next step).</p>
                </div>
            </section>

            <section id="students" aria-labelledby="students-h" style={{ marginBottom: 32 }}>
                <h2 id="students-h" style={{ marginBottom: 8 }}>Students</h2>
                <div style={{
                    padding: 16,
                    border: "1px solid #ddd",
                    borderRadius: 8,
                    background: "#fafafa"
                }}>
                    {/* Future: add/edit students */}
                    <p style={{ margin: 0 }}>Student tools placeholder.</p>
                </div>
            </section>

            <p style={{ marginTop: 12 }}>
                <Link href="/">← Back to home</Link>
            </p>
        </main>
    );
}
