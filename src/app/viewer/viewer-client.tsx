// src/app/viewer/viewer-client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { SONG } from "@/lib/song";
import ScoreOSMD from "@/components/ScoreOSMD";

export default function ViewerClient() {
  const params = useSearchParams();
  const paramSrc = params.get("src") ?? undefined;

  // Fallback to the first song if no ?src= was given
  const effectiveSrc = paramSrc ?? SONG[0]?.src;

  if (!effectiveSrc) {
    return (
      <p style={{ color: "crimson" }}>
        No score source provided. Try opening with{" "}
        <code>?src=/api/song/2/mxl</code>.
      </p>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        background: "#fff",
        width: "100%",
        minHeight: 0,
      }}
    >
      <ScoreOSMD src={effectiveSrc} />
    </div>
  );
}
