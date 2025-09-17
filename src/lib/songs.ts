// src/lib/songs.ts

export type Song = {
  title: string;
  src: string;            // API route (/api/songs/:id/mxl) or static file path
  composer?: string;
  difficulty?: number;    // Optional: could be 1–5 scale, or whatever you decide
};

/**
 * SONGS is declared as a non-empty tuple: [Song, ...Song[]].
 * This guarantees at least one element, so SONGS[0] is always defined.
 */
export const SONGS = [
  { title: "Gymnopédie No. 1 from Trois Gymnopédies",     src: "/api/songs/2/mxl" },
  { title: "Symphony No. 5 in C Minor - First Movement",  src: "/api/songs/3/mxl" },
] as const satisfies readonly [Song, ...Song[]];

export type SongItem = (typeof SONGS)[number];
