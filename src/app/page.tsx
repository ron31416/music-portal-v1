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
        className="fixed top-3 right-3 z-50 px-3 py-1.5 border border-gray-400 rounded-md bg-gray-50 text-gray-900 no-underline text-sm font-semibold shadow-sm"
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
