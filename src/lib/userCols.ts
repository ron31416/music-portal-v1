// src/lib/userCols.ts

/* ============================================================
   Canonical column tokens used at the client/server boundary
   (Single Source of Truth)
   ============================================================ */

export const USER_COL = {
  userId: "user_id",
  userName: "user_name",
  userEmail: "user_email",
  userFirstName: "user_first_name",
  userLastName: "user_last_name",
  userRoleId: "user_role_id",
  insertedDatetime: "inserted_datetime",
  updatedDatetime: "updated_datetime",
} as const;

/** Union of all known tokens (values of USER_COL) */
export type UserColToken = (typeof USER_COL)[keyof typeof USER_COL];

/** Quick runtime guard */
export function isUserColToken(v: unknown): v is UserColToken {
  return typeof v === "string" && Object.values(USER_COL).includes(v as UserColToken);
}

/* ============================================================
   Sorting whitelist
   Only these tokens are allowed for server-side ORDER BY.
   ============================================================ */

export const SORTABLE_USER_TOKENS = [
  USER_COL.userName,
  USER_COL.userEmail,
  USER_COL.userFirstName,
  USER_COL.userLastName,
  USER_COL.userRoleId,
  USER_COL.updatedDatetime,
] as const;

export type SortableUserColToken = (typeof SORTABLE_USER_TOKENS)[number];

export function isSortableUserColToken(v: unknown): v is SortableUserColToken {
  return typeof v === "string" && (SORTABLE_USER_TOKENS as readonly string[]).includes(v);
}

/* ============================================================
   Safe token → SQL column map (readonly)
   ============================================================ */

export const userTokenToSql: Readonly<Record<SortableUserColToken, string>> = {
  [USER_COL.userName]: "user_name",
  [USER_COL.userEmail]: "user_email",
  [USER_COL.userFirstName]: "user_first_name",
  [USER_COL.userLastName]: "user_last_name",
  [USER_COL.userRoleId]: "user_role_id",
  [USER_COL.updatedDatetime]: "updated_datetime",
} as const;

/* ============================================================
   Defaults
   ============================================================ */

export const DEFAULT_SORT: SortableUserColToken = USER_COL.userLastName;
export const DEFAULT_DIR = "asc" as const;
