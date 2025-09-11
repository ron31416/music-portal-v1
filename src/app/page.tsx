// src/app/page.tsx
import Link from "next/link";
import { SONGS } from "../lib/songs";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-3xl font-semibold">Music Portal</h1>
      <p className="text-sm opacity-80">
        Choose a score to open it in the Music Viewer (opens in a new tab).
      </p>

      <ul className="divide-y">
        {SONGS.map((s) => (
          <li key={s.src} className="py-3 flex items-center justify-between">
            <span>{s.title}</span>
            <Link
              href={{ pathname: "/viewer", query: { src: s.src, title: s.title } }}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 rounded border"
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
