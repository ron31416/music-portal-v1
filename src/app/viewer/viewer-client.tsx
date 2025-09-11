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

  // keep URL params in sync
  useEffect(() => {
    const qs = new URLSearchParams({ src: song.src, title: song.title }).toString();
    router.replace(`/viewer?${qs}`);
  }, [router, song]);

  return (
    // Full-viewport flex column so the viewer gets a concrete height
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Music Viewer</h1>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="song-select" style={{ fontSize: 14, opacity: 0.8 }}>
            Score:
          </label>
          <select
            id="song-select"
            value={song.src}
            onChange={(e) => {
              const next = SONGS.find((s) => s.src === e.target.value);
              setSong(next ?? { title: "Untitled", src: e.target.value });
            }}
          >
            {SONGS.map((s) => (
              <option key={s.src} value={s.src}>
                {s.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Title */}
      <div style={{ padding: "0 12px 8px" }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{song.title}</h2>
      </div>

      {/* Viewer area: flex-grow so it occupies the rest of the screen */}
      <div style={{ flex: 1, minHeight: 0, padding: "0 12px 12px" }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            height: "100%",        // <-- concrete height for ScoreOSMD to fill
            width: "100%",
            overflow: "hidden",
          }}
        >
          <ScoreOSMD
            src={song.src}
            // fillParent defaults to true; we also give the component a 100% box to fill:
            style={{ height: "100%", width: "100%" }}
            className=""
          />
        </div>
      </div>
    </div>
  );
}
