// Canonical DB 'song' table column names
export const SONG_COL = {
    songId: "song_id",
    songTitle: "song_title",
    composerFirstName: "composer_first_name",
    composerLastName: "composer_last_name",
    skillLevelNumber: "skill_level_number",
    skillLevelName: "skill_level_name",     //derived from join to skill_level
    fileName: "file_name",
    insertedDatetime: "inserted_datetime",
    updatedDatetime: "updated_datetime",
    songMxl: "song_mxl",
} as const;

export type SongColToken = typeof SONG_COL[keyof typeof SONG_COL];
