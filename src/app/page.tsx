// src/app/page.tsx
import Link from "next/link";
import { SONG, type Song } from "@/lib/song"; // use alias if configured
import SongListPanel from "@/components/SongListPanel";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Music Portal</h1>
      <p className="text-sm opacity-80">
        Choose a score to open it in the Music Viewer (opens in a new tab).
      </p>

      <ul className="space-y-2">
        {SONG.map((s: Song) => (
          <li key={s.src}>
            <Link
              href={{ pathname: "/viewer", query: { src: s.src } }}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded border px-3 py-2 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 cursor-pointer"
              title={`Open ${s.title} in Music Viewer`}
            >
              {s.title}
            </Link>
          </li>
        ))}
      </ul>

      {/* --- Student Song List (DB-backed) --- */}
      <section style={{ marginTop: 24, background: "#fff" }}>
        <SongListPanel />
      </section>
    </main>
  );
}
