// src/app/viewer/viewer-client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { SONGS } from "../../lib/songs";
import ScoreOSMD from "../../components/ScoreOSMD";

export default function ViewerClient() {
  const params = useSearchParams();
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
      <ScoreOSMD
        src={src}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
