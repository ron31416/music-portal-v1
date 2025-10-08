// src/lib/song.ts

export type Song = {
  title: string;
  src: string;            // API route (/api/song/:id/mxl) or static file path
  composer?: string;
  difficulty?: number;    // Optional: could be 1–5 scale, or whatever you decide
};

/**
 * SONG is declared as a non-empty tuple: [Song, ...Song[]].
 * This guarantees at least one element, so SONG[0] is always defined.
 */
export const SONG = [
  { title: "Gymnopédie No. 1 from Trois Gymnopédies", src: "/api/song/1/mxl" },
  { title: "Symphony No. 5 in C Minor - First Movement", src: "/api/song/2/mxl" },
] as const satisfies readonly [Song, ...Song[]];

export type SongItem = (typeof SONG)[number];
