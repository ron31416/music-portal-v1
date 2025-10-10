// Canonical DB 'song' table column names
export const SONG_COL = {
    songId: "song_id",
    songTitle: "song_title",
    composerFirstName: "composer_first_name",
    composerLastName: "composer_last_name",
    skillLevelNumber: "skill_level_number",
    fileName: "file_name",
    updatedDatetime: "updated_datetime",
    songMxl: "song_mxl",
} as const;

export type SongColToken = typeof SONG_COL[keyof typeof SONG_COL];
