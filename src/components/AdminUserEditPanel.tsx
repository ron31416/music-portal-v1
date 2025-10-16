
"use client";
import React from "react";

type Role = { number: number; name: string };
type Props = {
    userName: string;
    userEmail: string;
    userFirst: string;
    userLast: string;
    roleNumber: string;
    roles: ReadonlyArray<Role>;
    rolesLoading: boolean;
    rolesError: string;
    errorText: string;
    saveOkText: string;
    statusTick: number;
    canSave: boolean;
    saveLabel: string;
    canDelete: boolean;
    deleting: boolean;
    onChangeUserName(value: string): void;
    onChangeUserEmail(value: string): void;
    onChangeUserFirst(value: string): void;
    onChangeUserLast(value: string): void;
    onChangeRoleNumber(value: string): void;
    onPick(): void;
    onSave(): void;
    onDelete(): void;
    T: Readonly<Record<string, string | number>>;
    fieldCss: React.CSSProperties;
    isDark: boolean;
};

export default function AdminUserEditPanel(props: Props): React.ReactElement {
    const {
        userName,
        userEmail,
        userFirst,
        userLast,
        roleNumber,
        roles,
        rolesLoading,
        rolesError,
        errorText,
        saveOkText,
        statusTick,
        canSave,
        saveLabel,
        canDelete,
        deleting,
        onChangeUserName,
        onChangeUserEmail,
        onChangeUserFirst,
        onChangeUserLast,
        onChangeRoleNumber,
        onPick,
        onSave,
        onDelete,
        T,
        fieldCss,
        isDark,
    } = props;

    return (
        <section aria-label="Edit panel" style={{ marginTop: 8, background: "transparent" }}>
            <div
                id="edit-card"
                key={isDark ? "dark" : "light"}
                data-theme={isDark ? "dark" : "light"}
                style={{
                    padding: 16,
                    border: `1px solid ${T.border}`,
                    borderRadius: 8,
                    background: T.bgCard as string,
                    backgroundColor: T.bgCard as string,
                    color: T.fgCard as string,
                }}
            >
                <div
                    style={{
                        marginTop: 0,
                        display: "grid",
                        gridTemplateColumns: "120px 1fr",
                        rowGap: 10,
                        columnGap: 12,
                        background: "transparent",
                    }}
                >
                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Username</label>
                    <input
                        type="text"
                        value={userName}
                        onChange={(e) => { onChangeUserName(e.target.value); }}
                        style={fieldCss}
                    />

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Email</label>
                    <input
                        type="email"
                        value={userEmail}
                        onChange={(e) => { onChangeUserEmail(e.target.value); }}
                        style={fieldCss}
                    />

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Name</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input
                            type="text"
                            value={userFirst}
                            onChange={(e) => { onChangeUserFirst(e.target.value); }}
                            placeholder="First"
                            style={fieldCss}
                        />
                        <input
                            type="text"
                            value={userLast}
                            onChange={(e) => { onChangeUserLast(e.target.value); }}
                            placeholder="Last"
                            style={fieldCss}
                        />
                    </div>

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Role Number</label>
                    <select
                        value={roleNumber}
                        onChange={(e) => { onChangeRoleNumber(e.target.value); }}
                        disabled={rolesLoading || (rolesError.length > 0) || roles.length === 0}
                        style={{ ...fieldCss, appearance: "auto" as const }}
                    >
                        <option value="" disabled>— Select a role —</option>
                        {roles.map((role) => (
                            <option key={role.number} value={String(role.number)}>
                                {role.name}
                            </option>
                        ))}
                    </select>

                    {rolesError && (
                        <div style={{ gridColumn: "1 / span 2", color: "#b00020" }}>
                            Failed to load roles: {rolesError}
                        </div>
                    )}
                </div>

                <div
                    style={{
                        marginTop: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    <button
                        type="button"
                        onClick={onPick}
                        style={{
                            padding: "8px 12px",
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            background: isDark ? "#1f1f1f" : "#fafafa",
                            color: isDark ? "#fff" : "#111",
                            cursor: "pointer",
                        }}
                    >
                        Clear
                    </button>

                    <span
                        key={`status-${statusTick}`}
                        aria-live="polite"
                        role={errorText ? "alert" : (saveOkText ? "status" : undefined)}
                        title={errorText || saveOkText || ""}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            textAlign: "right",
                            color: errorText ? "#ff6b6b" : (T.headerFg as string),
                            fontWeight: 500,
                            margin: 0,
                            visibility: (errorText || saveOkText) ? "visible" : "hidden",
                        }}
                    >
                        {errorText || saveOkText || ""}
                    </span>

                    <button
                        type="button"
                        onClick={onSave}
                        disabled={!canSave}
                        style={{
                            padding: "8px 12px",
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            background: isDark ? "#1f1f1f" : "#fafafa",
                            color: isDark ? "#fff" : "#111",
                            cursor: canSave ? "pointer" : "not-allowed",
                            opacity: canSave ? 1 : 0.5,
                        }}
                    >
                        {saveLabel}
                    </button>

                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={!canDelete}
                        style={{
                            padding: "8px 12px",
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            background: isDark ? "#1f1f1f" : "#fafafa",
                            color: isDark ? "#fff" : "#111",
                            cursor: canDelete ? "pointer" : "not-allowed",
                            opacity: canDelete ? 1 : 0.5,
                        }}
                        title={canDelete ? "Delete this user permanently" : "Delete unavailable"}
                    >
                        {deleting ? "Deleting…" : "Delete User"}
                    </button>
                </div>
            </div>
        </section>
    );
}
