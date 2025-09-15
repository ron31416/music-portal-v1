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
  { title: "musicalion54541-1", src: "/scores/musicalion54541-1.xml" },
  { title: "musicalion96385-1", src: "/scores/musicalion96385-1.xml" },
  { title: "arabesque-l-66-no-1-in-e-major", src: "/scores/arabesque-l-66-no-1-in-e-major.xml" },
  { title: "ave-maria-d839-schubert-solo-piano-arrg", src: "/scores/ave-maria-d839-schubert-solo-piano-arrg.xml" },
  { title: "beethoven-symphony-no-5-1st-movement-piano-solo", src: "/scores/beethoven-symphony-no-5-1st-movement-piano-solo.xml" },
  { title: "canon-in-d", src: "/scores/canon-in-d.xml" },
] as const satisfies readonly [Song, ...Song[]];

export type SongItem = (typeof SONGS)[number];
