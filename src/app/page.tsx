// src/app/page.tsx
"use client";

import React from "react";
import Link from "next/link";

import { usePrefersDark, themeTokens } from "@/lib/theme";
import SongListPanel from "@/components/SongListPanel";
import type { SongListItem } from "@/lib/types";
import { type SongColToken, DEFAULT_SORT, DEFAULT_DIR } from "@/lib/songCols";

// --- Config ---

//                   Last First Title Level
const GRID_COLS_PX = [140, 140, 260, 120] as const;
const GRID_COLS: React.CSSProperties["gridTemplateColumns"] =
  GRID_COLS_PX.map((n) => `${n}px`).join(" ");
const TABLE_MIN_PX = GRID_COLS_PX.reduce((a, b) => a + b, 0);
const TABLE_ROW_PX = 40;
const TABLE_ROW_COUNT = 15;

const SONG_LIST_ENDPOINT = "/api/songlist";


// --- Types ---

type SortDir = "asc" | "desc";


// --- Component ---

export default function HomePage(): React.ReactElement {
  // Theme
  const isDark = usePrefersDark();
  const T = React.useMemo(() => themeTokens(isDark), [isDark]);

  // Data/state
  const [rows, setRows] = React.useState<SongListItem[]>([]);
  const [listLoading, setListLoading] = React.useState(false);
  const [listError, setListError] = React.useState("");

  // Server-side sorting (defaults from songCols)
  const [sort, setSort] = React.useState<SongColToken | null>(DEFAULT_SORT);
  const [sortDir, setSortDir] = React.useState<SortDir>(DEFAULT_DIR);

  // Fetch lifecycle management
  const listAbortRef = React.useRef<AbortController | null>(null);
  const listSeqRef = React.useRef(0);

  const refreshSongList = React.useCallback(
    async (
      overrideSort?: SongColToken | null,
      overrideDir?: SortDir,
      showSpinner: boolean = true
    ): Promise<void> => {
      setListError("");
      if (showSpinner) {
        setListLoading(true);
      }

      if (listAbortRef.current !== null) {
        listAbortRef.current.abort();
      }

      const controller = new AbortController();
      listAbortRef.current = controller;
      const seq = listSeqRef.current + 1;
      listSeqRef.current = seq;

      try {
        const params = new URLSearchParams();
        const effSort = overrideSort ?? sort;
        const effDir: SortDir = overrideDir ?? sortDir;

        if (effSort !== null) {
          params.set("sort", effSort);
          params.set("dir", effDir);
        }

        const res = await fetch(`${SONG_LIST_ENDPOINT}?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as unknown;
        if (seq !== listSeqRef.current) {
          return; // stale
        }

        const items = (json && typeof json === "object"
          ? (json as Record<string, unknown>).items
          : []) as unknown;

        const cast: SongListItem[] = [];
        if (Array.isArray(items)) {
          for (const it of items) {
            if (it && typeof it === "object") {
              const r = it as Record<string, unknown>;
              const id = r.song_id;
              if (typeof id === "number" && Number.isFinite(id)) {
                cast.push({
                  song_id: id,
                  song_title: String(r.song_title ?? ""),
                  composer_first_name: String(r.composer_first_name ?? ""),
                  composer_last_name: String(r.composer_last_name ?? ""),
                  skill_level_name: String(r.skill_level_name ?? ""),
                  skill_level_number: Number(r.skill_level_number ?? 0),
                  file_name: String(r.file_name ?? ""),
                  inserted_datetime: String(r.inserted_datetime ?? ""),
                  updated_datetime: String(r.updated_datetime ?? ""),
                });
              }
            }
          }
        }

        setRows(cast);
      } catch (e: unknown) {
        const name = (e as { name?: string } | null)?.name ?? "";
        if (name === "AbortError") {
          return;
        }
        setListError(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        if (seq === listSeqRef.current) {
          setListLoading(false);
        }
      }
    },
    [sort, sortDir]
  );

  React.useEffect(() => {
    void refreshSongList();
    return () => {
      if (listAbortRef.current !== null) {
        listAbortRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSort = (key: SongColToken): void => {
    const nextDir: SortDir =
      sort === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    setSort(key);
    setSortDir(nextDir);
    void refreshSongList(key, nextDir);
  };

  const openInNewTab = (id: number): void => {
    const tabId = Date.now().toString(36);
    const url = `/viewer?tab=${tabId}&id=${id}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="mx-auto max-w-2xl p-6 space-y-6">
      {/* Top-right Admin button */}
      <Link
        href="/admin"
        aria-label="Go to Admin"
        prefetch={false}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 1000,
          padding: "8px 12px",
          border: `1px solid ${T.border}`,
          borderRadius: 6,
          background: T.bgCard as string,
          color: T.fgCard as string,
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
          cursor: "pointer",
        }}
      >
        Admin
      </Link>

      <h1 className="text-3xl font-semibold" style={{ color: T.fgCard as string }}>
        Music Portal
      </h1>

      <section style={{ marginTop: 24 }}>
        <SongListPanel
          rows={rows}
          listLoading={listLoading}
          listError={listError}
          sort={sort}
          sortDir={sortDir}
          onToggleSort={toggleSort}
          onRowClick={(row) => { openInNewTab(row.song_id); }}
          gridCols={GRID_COLS}
          tableMinPx={TABLE_MIN_PX}
          rowPx={TABLE_ROW_PX}
          visibleRowCount={TABLE_ROW_COUNT}
          T={T}
        />
      </section>

      {/* Global guardrails for header colors in case of stray CSS */}
      <style jsx global>{`
        #songs-header {
          background: ${T.headerBg} !important;
          color: ${T.headerFg} !important;
        }
        #songs-header button,
        #songs-header * {
          color: ${T.headerFg} !important;
        }
      `}</style>
    </main>
  );
}
