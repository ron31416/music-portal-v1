// src/lib/songs.ts
export type Song = { title: string; src: string };

export const SONGS: Song[] = [
  { title: "Brahms – Violin Concerto (excerpt)", src: "/scores/Brahms-violin-concerto.musicxml" },
  { title: "Satie – Gymnopédie No. 1",              src: "/scores/gymnopedie-no-1-satie.mxl" },
  { title: "Parlez-moi",                              src: "/scores/Parlez-moi.mxl" },
  { title: "Schumann – The Wild Horseman, Op. 68 No. 8", src: "/scores/Schumann-The-Wild-Horseman-Op.-68-No.-8.mxl" },
];
