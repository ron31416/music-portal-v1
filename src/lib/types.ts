// src/lib/types.ts

/* ============================================================
   Canonical API response envelopes
   ============================================================ */

export type ApiOk<TBody> = Readonly<{ ok: true } & TBody>;
export type ApiErr = Readonly<{ ok: false; error: string; message?: string }>;

/* ============================================================
   Song list item (as returned by song_list)
   ============================================================ */

export type SongListItem = Readonly<{
   song_id: number;
   song_title: string;
   composer_first_name: string;
   composer_last_name: string;
   skill_level_name: string;
   skill_level_number: number;
   file_name: string;
   inserted_datetime: string;
   updated_datetime: string;
}>;

/* ============================================================
   GET /api/songlist response
   (current contract in your UI: { items: SongListItem[] })
   ============================================================ */

export type SongListResponse = Readonly<{ items: SongListItem[] }>;
// If you later standardize to include "ok", you could switch to:
// export type SongListOk = ApiOk<{ items: SongListItem[] }>;

/* ============================================================
   /api/song/[id]/mxl DB row view
   (only the columns that route selects)
   ============================================================ */

export type SongMxlRow = Readonly<{
   song_mxl: unknown;
   song_title: string | null;
}>;


export type UserListItem = Readonly<{
   user_id: number;
   user_name: string;
   user_email: string;
   user_first_name: string;
   user_last_name: string;
   user_role_number: number;
   user_role_name: string;
   inserted_datetime: string;
   updated_datetime: string;
}>;
