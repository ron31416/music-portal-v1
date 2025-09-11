"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// Lazy import so it never runs on the server
const useOSMD = () =>
  useMemo(() => import("opensheetmusicdisplay").then(m => m.OpenSheetMusicDisplay), []);

export default function ViewerClient() {
  const params = useSearchParams();
  const src = params.get("src") || "/scores/minuet.mxl";
  const title = params.get("title") || "Untitled";
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let osmd: any;
    let cancelled = false;

    (async () => {
      try {
        const OpenSheetMusicDisplay = await useOSMD();
        if (cancelled || !containerRef.current) return;

        osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: true,
          drawTitle: true,
        });

        await osmd.load(src);
        await osmd.render();
      } catch (e: any) {
        setError(e?.message || "Failed to load score.");
      }
    })();

    return () => {
      cancelled = true;
      // OSMD doesn't require explicit dispose, but clearing container helps if re-opened
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
    // re-run if src changes
  }, [src]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold mb-3">{title}</h1>
      {error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div ref={containerRef} className="border rounded p-3 overflow-auto" />
      )}
      <p className="mt-3 text-sm opacity-70">Source: <code>{src}</code></p>
    </div>
  );
}
