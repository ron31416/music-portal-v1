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
        // no vh/vw here; let the child set its own height using visualViewport
        position: "relative",
        background: "#fff",
        width: "100%",
        minHeight: 0,
      }}
    >
      <ScoreOSMD src={src} />
    </div>
  );
}
