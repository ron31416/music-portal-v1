// src/lib/songs.ts

export type Song = {
  title: string;
  src: string;            // Path to the MusicXML file in /public/scores/
  composer?: string;
  difficulty?: number;    // Optional: could be 1–5 scale, or whatever you decide
};

/**
 * SONGS is declared as a non-empty tuple: [Song, ...Song[]].
 * This guarantees at least one element, so SONGS[0] is always defined.
 */
export const SONGS = [
  { title: "Brahms – Violin Concerto (excerpt)", src: "/scores/Brahms-violin-concerto.musicxml" },
  { title: "Satie – Gymnopédie No. 1",            src: "/scores/gymnopedie-no-1-satie.mxl" },
  { title: "Parlez-moi",                          src: "/scores/Parlez-moi.mxl" },
  { title: "Schumann – The Wild Horseman, Op. 68 No. 8", src: "/scores/Schumann-The-Wild-Horseman-Op.-68-No.-8.mxl" },
] as const satisfies readonly [Song, ...Song[]];

export type SongItem = (typeof SONGS)[number];
