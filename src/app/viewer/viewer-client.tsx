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

  // Initial selection: URL params if present, else first song
  const initialSong: Song =
    (paramSrc && { title: paramTitle ?? "Untitled", src: paramSrc }) || SONGS[0];

  const [song, setSong] = useState<Song>(initialSong);

  // Keep the URL query in sync without a full navigation
  useEffect(() => {
    const qs = new URLSearchParams({ src: song.src, title: song.title }).toString();
    router.replace(`/viewer?${qs}`);
  }, [router, song]);

  return (
    <div className="mx-auto" style={{ maxWidth: 1100 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
      </header>

      <h2 style={{ fontSize: 22, fontWeight: 600, margin: "12px 0" }}>{song.title}</h2>

      {/* White canvas so notation is clear even in dark themes */}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 12,
        }}
      >
        <ScoreOSMD
          src={song.src}
          /* Your component defaults: fillParent=true, initialZoom=1.
             If you prefer a fixed-height frame, uncomment the two lines below: */
          // fillParent={false}
          // height={680}
          className=""
          style={{}}
        />
      </div>
    </div>
  );
}
