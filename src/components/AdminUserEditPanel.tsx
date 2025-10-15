// src/components/AdminUserEditPanel.tsx
"use client";

import React from "react";

type Props = {
    // Values (controlled)
    userName: string;
    userEmail: string;
    userFirst: string;
    userLast: string;
    roleNumber: string; // selected user_role_number as string

    errorText: string;
    saveOkText: string;
    statusTick: number;

    // Computed enables/labels
    canSave: boolean;
    saveLabel: string;
    canDelete: boolean;
    deleting: boolean;

    // Handlers (controlled updates)
    onChangeUserName(value: string): void;
    onChangeUserEmail(value: string): void;
    onChangeUserFirst(value: string): void;
    onChangeUserLast(value: string): void;
    onChangeRoleNumber(value: string): void;

    // Keep prop names parallel to Songs (onPick here = “Clear Entry”)
    onPick(): void;
    onSave(): void;
    onDelete(): void;

    // Theming / layout
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

        onPick,     // Clear Entry
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
                key={isDark ? "dark" : "light"} // force remount when theme flips
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
                    <input
                        type="number"
                        value={roleNumber}
                        onChange={(e) => { onChangeRoleNumber(e.target.value); }}
                        placeholder="e.g. 1"
                        style={fieldCss}
                    />
                </div>

                <div
                    style={{
                        marginTop: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    {/* Left-side button: Clear Entry (uses Songs' prop name onPick) */}
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
                        Clear Entry
                    </button>

                    {/* Middle: status message fills available space */}
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

                    {/* Right-side buttons: Save, Delete */}
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
