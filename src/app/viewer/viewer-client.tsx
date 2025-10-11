// src/app/viewer/viewer-client.tsx
"use client";

import { useSearchParams } from "next/navigation";
import ScoreViewer from "@/components/ScoreViewer";

function isPositiveIntString(v: string | null): v is string {
  return v !== null && /^\d+$/.test(v);
}

export default function ViewerClient(): React.ReactElement {
  const params = useSearchParams();
  const id = isPositiveIntString(params.get("id")) ? params.get("id")! : undefined;

  // Build the canonical, same-origin API URL from the id
  const src = id !== undefined ? `/api/song/${id}/mxl` : undefined;

  if (src === undefined) {
    return (
      <p style={{ color: "crimson" }}>
        No score id provided. Open this page with <code>?id=2</code>.
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
      <ScoreViewer src={src} />
    </div>
  );
}
