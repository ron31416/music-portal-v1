// src/app/viewer/viewer-client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { SONGS } from "../../lib/songs";
import ScoreOSMD from "../../components/ScoreOSMD";

export default function ViewerClient() {
  const params = useSearchParams();

  // If ?src= is present, use it; otherwise fall back to the first known song.
  // Because SONGS is a non-empty tuple, SONGS[0].src is always safe.
  const src = params.get("src") ?? SONGS[0].src;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        position: "relative",
        background: "#fff",
      }}
    >
      <ScoreOSMD src={src} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
