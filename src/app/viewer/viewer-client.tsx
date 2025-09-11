"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { OpenSheetMusicDisplay as OSMDClass } from "opensheetmusicdisplay";

type Song = { title: string; src: string };

// Starter library — uses your current files under /public/scores
const SONGS: Song[] = [
  { title: "Brahms – Violin Concerto (excerpt)", src: "/scores/Brahms-violin-concerto.musicxml" },
  { title: "Satie – Gymnopédie No. 1", src: "/scores/gymnopedie-no-1-satie.mxl" },
  { title: "Parlez-moi", src: "/scores/Parlez-moi.mxl" },
  { title: "Schumann – The Wild Horseman, Op. 68 No. 8", src: "/scores/Schumann-The-Wild-Horseman-Op.-68-No.-8.mxl" },
];

// Dynamic loader (NOT a hook) so ESLint doesn’t complain
const loadOSMD = () =>
  import("opensheetmusicdisplay").then((m) => m.OpenSheetMusicDisplay);

export default function ViewerClient() {
  const params = useSearchParams();
  const router = useRouter();

  // Parse incoming query (if any)
  const paramSrc = params.get("src");
  const paramTitle = params.get("title");

  // Choose initial song: query param if present, otherwise first in list
  const initialSong: Song =
    (paramSrc && { title: paramTitle ?? "Untitled", src: paramSrc }) ||
    SONGS[0];

  const [song, setSong] = useState<Song>(initialSong);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Stable memo of the loader
  const getOSMD = useMemo(() => loadOSMD, []);

  // Keep the URL in sync (no full reload)
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("src", song.src);
    url.searchParams.set("title", song.title);
    router.replace(url.toString());
  }, [router, song]);

  // Load + render whenever song changes
  useEffect(() => {
    let osmd: InstanceType<typeof OSMDClass> | null = null;
    let cancelled = false;

    (async () => {
      setError(null);
      setLoading(true);
      try {
        const OpenSheetMusicDisplay = await getOSMD();
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) return;

        // Clear any previous render
        container.innerHTML = "";

        osmd = new OpenSheetMusicDisplay(container, {
          autoResize: true,
          drawTitle: true,
        });

        await osmd.load(song.src);
        if (cancelled) return;
        await osmd.render();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Failed to load or render the score.";
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // OSMD has no explicit dispose, clearing the container is sufficient
      if (containerRef.current) containerRef.current.innerHTML = "";
      osmd = null;
    };
  }, [getOSMD, song]);

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Music Viewer</h1>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-sm opacity-80" htmlFor="song-select">
            Score:
          </label>
          <select
            id="song-select"
            className="border rounded px-2 py-1"
            value={song.src}
            onChange={(e) => {
              const next = SONGS.find((s) => s.src === e.target.value);
              if (next) setSong(next);
              else setSong({ title: "Untitled", src: e.target.value });
            }}
          >
            {SONGS.map((s) => (
              <option key={s.src} value={s.src}>
                {s.title}
              </option>
            ))}
            {/* If arriving with a src not in SONGS, keep it selectable */}
            {!SONGS.find((s) => s.src === initialSong.src) && (
              <option value={initialSong.src}>{initialSong.title}</option>
            )}
          </select>
        </div>
      </header>

      <h2 className="text-lg font-medium">{song.title}</h2>

      {error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <div
          ref={containerRef}
          className="border rounded p-3 min-h-[300px] overflow-auto"
          aria-busy={loading}
        />
      )}

      <p className="mt-2 text-sm opacity-70">
        Source: <code>{song.src}</code>
      </p>
    </div>
  );
}
