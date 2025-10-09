// src/app/page.tsx

import SongListPanel from "@/components/SongListPanel";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Top-right Admin button */}
      <Link
        href="/admin"
        aria-label="Go to Admin"
        prefetch={false}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 1000,
          padding: "8px 12px",
          border: "1px solid #aaa",
          borderRadius: 6,
          background: "#fff",
          color: "#111",
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
          cursor: "pointer",
        }}
      >
        Admin
      </Link>

      <h1 className="text-3xl font-semibold">Music Portal</h1>

      <section style={{ marginTop: 24 }}>
        <SongListPanel />
      </section>
    </main>
  );
}
