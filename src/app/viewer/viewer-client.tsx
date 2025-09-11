// src/app/viewer/viewer-client.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { SONGS, type Song } from "../../lib/songs";
import ScoreOSMD from "../../components/ScoreOSMD";

export default function ViewerClient() {
  const params = useSearchParams();
  const router = useRouter();

  const paramSrc = params.get("src");
  const paramTitle = params.get("title");

  const initialSong: Song =
    (paramSrc && { title: paramTitle ?? "Untitled", src: paramSrc }) || SONGS[0];

  const [song, setSong] = useState<Song>(initialSong);

  // keep URL query in sync (no full nav)
  useEffect(() => {
    const qs = new URLSearchParams({ src: song.src, title: song.title }).toString();
    router.replace(`/viewer?${qs}`);
  }, [router, song]);

  return (
    // Full-viewport canvas for OSMD; position:relative for overlay controls
    <div
      style={{
        height: "100vh",
        width: "100vw",
        position: "relative",
        background: "#fff", // white canvas so notation is crisp even in dark mode
      }}
    >
      {/* Full-bleed viewer */}
      <ScoreOSMD
        src={song.src}
        // fillParent defaults to true in your component; ensure it expands
        style={{ height: "100%", width: "100%" }}
      />

      {/* Lightweight overlay control (doesn't consume layout space) */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 8px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.85)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
        }}
      >
        <label htmlFor="song-select" style={{ fontSize: 12, opacity: 0.8 }}>
          Score:
        </label>
        <select
          id="song-select"
          value={song.src}
          onChange={(e) => {
            const next = SONGS.find((s) => s.src === e.target.value);
            setSong(next ?? { title: "Untitled", src: e.target.value });
          }}
          style={{ fontSize: 14 }}
        >
          {SONGS.map((s) => (
            <option key={s.src} value={s.src}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
