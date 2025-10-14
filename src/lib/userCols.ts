// src/lib/userCols.ts

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

export type UserColToken = keyof typeof USER_COL;

export const USER_COL_LABEL: Record<UserColToken, string> = {
  userId: "ID",
  userName: "Username",
  userEmail: "Email",
  userFirstName: "First",
  userLastName: "Last",
  userRoleId: "Role",
  insertedDatetime: "Inserted",
  updatedDatetime: "Updated",
};

export const DEFAULT_SORT: UserColToken = "userLastName";
export const DEFAULT_DIR: "asc" | "desc" = "asc";

/** Map a UserColToken to the backend column string */
export function colToServerKey(col: UserColToken): string {
  return USER_COL[col];
}
