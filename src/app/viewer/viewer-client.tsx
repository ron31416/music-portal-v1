// src/app/viewer/viewer-client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { SONGS } from "../../lib/songs";
import ScoreOSMD from "../../components/ScoreOSMD";

type Props = { src?: string };

export default function ViewerClient({ src }: Props) {
  const params = useSearchParams();
  const paramSrc = params.get("src") ?? undefined;

  const effectiveSrc = src ?? paramSrc ?? SONGS[0]?.src;

  if (!effectiveSrc) {
    return <p style={{ color: "crimson" }}>No score source provided.</p>;
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
