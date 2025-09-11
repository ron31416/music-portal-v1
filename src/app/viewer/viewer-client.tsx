"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { OpenSheetMusicDisplay as OSMDClass } from "opensheetmusicdisplay";
import { SONGS, type Song } from "@/lib/songs";

// Dynamic loader (NOT a hook)
const loadOSMD = () =>
  import("opensheetmusicdisplay").then((m) => m.OpenSheetMusicDisplay);

export default function ViewerClient() {
  const params = useSearchParams();
  const router = useRouter();

  // From URL (if provided), else first song
  const paramSrc = params.get("src");
  const paramTitle = params.get("title");
  const initialSong: Song =
    (paramSrc && { title: paramTitle ?? "Untitled", src: paramSrc }) ||
    SONGS[0];

  const [song, setSong] = useState<Song>(initialSong);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const getOSMD = useMemo(() => loadOSMD, []);

  // Keep URL in sync (relative path only)
  useEffect(() => {
    const qs = new URLSearchParams({ src: song.src, title: song.title }).toString();
    router.replace(`/viewer?${qs}`);
  }, [router, song]);

  // Load + render the selected score
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
        container.innerHTML = "";

        osmd = new OpenSheetMusicDisplay(container, {
          autoResize: true,
          drawTitle: true,
        });

        // Build an ABSOLUTE URL so there’s no ambiguity about where we’re fetching from
        const href = song.src.startsWith("http")
          ? song.src
          : new URL(song.src, window.location.origin).toString();

        await osmd.load(href); // OSMD will fetch this URL
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

      <h2 className="text-lg font-medium">{song.title}</h2>

      {error ? (
        <div className="text-red-600">
          <p>{error}</p>
          <p className="mt-2">
            Try opening the file directly:{" "}
            <a
              className="underline"
              href={song.src}
              target="_blank"
              rel="noopener noreferrer"
            >
              {song.src}
            </a>
          </p>
        </div>
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
