"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { OpenSheetMusicDisplay as OSMDClass } from "opensheetmusicdisplay";

// Dynamic loader (NOT a hook)
const loadOSMD = () =>
  import("opensheetmusicdisplay").then(m => m.OpenSheetMusicDisplay);

export default function ViewerClient() {
  const params = useSearchParams();
  const src = params.get("src") || "/scores/minuet.mxl";
  const title = params.get("title") || "Untitled";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Stable memo of the loader to avoid re-creating the function identity
  const getOSMD = useMemo(() => loadOSMD, []);

  useEffect(() => {
    let osmd: InstanceType<typeof OSMDClass> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const OpenSheetMusicDisplay = await getOSMD();
        if (cancelled || !containerRef.current) return;

        osmd = new OpenSheetMusicDisplay(containerRef.current, {
          autoResize: true,
          drawTitle: true,
        });

        await osmd.load(src);
        await osmd.render();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Failed to load or render the score.";
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = "";
      osmd = null;
    };
  }, [getOSMD, src]);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold mb-3">{title}</h1>
      {error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div ref={containerRef} className="border rounded p-3 overflow-auto" />
      )}
      <p className="mt-3 text-sm opacity-70">
        Source: <code>{src}</code>
      </p>
    </div>
  );
}
