// src/components/AdminSongEditPanel.tsx
"use client";

import React from "react";

type Level = { number: number; name: string };

type Props = {
    // Values (controlled)
    title: string;
    composerFirst: string;
    composerLast: string;
    level: string; // selected level_number as string
    levels: ReadonlyArray<Level>;
    levelsLoading: boolean;
    levelsError: string;
    fileName: string;
    xml: string;
    xmlLoading: boolean;
    parsing: boolean;
    errorText: string;
    saveOkText: string;
    statusTick: number;

    // Computed enables/labels
    canSave: boolean;
    saveLabel: string;
    canView: boolean;
    canDelete: boolean;
    deleting: boolean;


    // Handlers (controlled updates)
    onChangeTitle(value: string): void;
    onChangeComposerFirst(value: string): void;
    onChangeComposerLast(value: string): void;
    onChangeLevel(value: string): void;
    onChangeXml(value: string): void;
    onPick: React.ChangeEventHandler<HTMLInputElement>;
    onSave(): void;
    onOpenViewer(): void;
    onDelete(): void;

    // Refs
    fileInputRef: React.RefObject<HTMLInputElement | null>;

    // Theming / layout
    T: Readonly<Record<string, string | number>>;
    fieldCss: React.CSSProperties;
    isDark: boolean;
    xmlPreviewHeight: number;
};

export default function AdminSongEditPanel(props: Props): React.ReactElement {
    const {
        title,
        composerFirst,
        composerLast,
        level,
        levels,
        levelsLoading,
        levelsError,
        fileName,
        xml,
        xmlLoading,
        parsing,
        errorText,
        saveOkText,
        statusTick,

        canSave,
        saveLabel,
        canView,
        canDelete,
        deleting,

        onChangeTitle,
        onChangeComposerFirst,
        onChangeComposerLast,
        onChangeLevel,
        onChangeXml,
        onPick,
        onSave,
        onOpenViewer,
        onDelete,

        fileInputRef,

        T,
        fieldCss,
        isDark,
        xmlPreviewHeight,
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
                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Song Title</label>
                    <input
                        type="text"
                        value={title}
                        onChange={(e) => { onChangeTitle(e.target.value); }}
                        style={fieldCss}
                    />

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Composer</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input
                            type="text"
                            value={composerFirst}
                            onChange={(e) => { onChangeComposerFirst(e.target.value); }}
                            placeholder="First"
                            style={fieldCss}
                        />
                        <input
                            type="text"
                            value={composerLast}
                            onChange={(e) => { onChangeComposerLast(e.target.value); }}
                            placeholder="Last"
                            style={fieldCss}
                        />
                    </div>

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>Skill Level</label>
                    <select
                        value={level}
                        onChange={(e) => { onChangeLevel(e.target.value); }}
                        disabled={levelsLoading || (levelsError.length > 0) || levels.length === 0}
                        style={{ ...fieldCss, appearance: "auto" as const }}
                    >
                        <option value="" disabled>— Select a level —</option>
                        {levels.map((lvl) => {
                            return (
                                <option key={lvl.number} value={String(lvl.number)}>
                                    {lvl.name}
                                </option>
                            );
                        })}
                    </select>

                    {levelsError && (
                        <div style={{ gridColumn: "1 / span 2", color: "#b00020" }}>
                            Failed to load skill levels: {levelsError}
                        </div>
                    )}

                    <label style={{ alignSelf: "center", fontWeight: 600 }}>File Name</label>
                    <input type="text" value={fileName} readOnly style={fieldCss} />

                    <label style={{ fontWeight: 600, paddingTop: 6 }}>MusicXML</label>
                    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-start", marginBottom: 8 }}>
                        <button
                            type="button"
                            onClick={onOpenViewer}
                            disabled={!canView || xmlLoading}
                            style={{
                                padding: "8px 12px",
                                border: `1px solid ${T.border}`,
                                borderRadius: 6,
                                background: isDark ? "#1f1f1f" : "#fafafa",
                                color: isDark ? "#fff" : "#111",
                                cursor: (!canView || xmlLoading) ? "not-allowed" : "pointer",
                                opacity: (!canView || xmlLoading) ? 0.5 : 1,
                                marginRight: 12,
                                whiteSpace: "nowrap",
                                fontSize: 13,
                                fontWeight: 500,
                            }}
                        >
                            View Song
                        </button>
                        <textarea
                            aria-label="XML"
                            value={xml}
                            onChange={(e) => { onChangeXml(e.target.value); }}
                            spellCheck={false}
                            style={{
                                ...fieldCss,
                                width: "100%",
                                margin: 0,
                                minHeight: xmlPreviewHeight,
                                maxHeight: xmlPreviewHeight,
                                overflow: "auto",
                                resize: "vertical",
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                                fontSize: 13,
                                lineHeight: 1.4,
                            }}
                        />
                    </div>
                </div>

                <div
                    style={{
                        marginTop: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                    }}
                >
                    {/* Hidden file input lives inside the card */}
                    <input
                        ref={fileInputRef}
                        id="song-file-input"
                        type="file"
                        accept=".mxl,.musicxml,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml,application/zip"
                        onChange={onPick}
                        style={{ display: "none" }}
                    />

                    {/* Left-side button: Load */}
                    <button
                        type="button"
                        onClick={() => {
                            if (fileInputRef.current) {
                                fileInputRef.current.click();
                            }
                        }}
                        style={{
                            padding: "8px 12px",
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            background: isDark ? "#1f1f1f" : "#fafafa",
                            color: isDark ? "#fff" : "#111",
                            cursor: "pointer",
                        }}
                    >
                        Load Song
                    </button>

                    {/* Middle: status message fills available space */}
                    <span
                        key={`status-${statusTick}`}
                        aria-live="polite"
                        role={parsing ? "status" : (errorText ? "alert" : (saveOkText ? "status" : undefined))}
                        title={parsing ? "Parsing…" : (errorText || saveOkText || "")}
                        style={{
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            textAlign: "center",
                            color: parsing ? (isDark ? "#ccc" : "#555") : (errorText ? "#ff6b6b" : (T.headerFg as string)),
                            fontWeight: 500,
                            margin: 0,
                            visibility: (parsing || errorText || saveOkText) ? "visible" : "hidden",
                        }}
                    >
                        {parsing ? "Parsing…" : (errorText || saveOkText || "")}
                    </span>

                    {/* Right-side buttons: Save, View, Delete */}
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
                        onClick={onOpenViewer}
                        disabled={!canView || xmlLoading}
                        style={{
                            padding: "8px 12px",
                            border: `1px solid ${T.border}`,
                            borderRadius: 6,
                            background: isDark ? "#1f1f1f" : "#fafafa",
                            color: isDark ? "#fff" : "#111",
                            cursor: (!canView || xmlLoading) ? "not-allowed" : "pointer",
                            opacity: (!canView || xmlLoading) ? 0.5 : 1,
                        }}
                    >
                        View Song
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
                        title={canDelete ? "Delete this song permanently" : "Delete unavailable"}
                    >
                        {deleting ? "Deleting…" : "Delete Song"}
                    </button>
                </div>
            </div>
        </section>
    );
}
