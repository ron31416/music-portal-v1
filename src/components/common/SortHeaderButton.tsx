// src/components/common/SortHeaderButton.tsx
"use client";

import React from "react";

export type SortDir = "asc" | "desc";

export type SortHeaderButtonProps<K extends string> = {
    col: K;
    curSort: K | null;
    dir: SortDir;
    onToggle: (k: K) => void;

    label: string;
    title?: string;
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
    ariaSortOverride?: "none" | "ascending" | "descending";
};

export default function SortHeaderButton<K extends string>(
    props: SortHeaderButtonProps<K>
): React.ReactElement {
    const {
        col,
        curSort,
        dir,
        onToggle,
        label,
        title,
        disabled,
        className,
        style,
        ariaSortOverride,
    } = props;

    const isActive: boolean = curSort === col;
    const ariaSort: "none" | "ascending" | "descending" =
        ariaSortOverride ??
        (isActive ? (dir === "asc" ? "ascending" : "descending") : "none");

    function handleActivate(): void {
        if (disabled) {
            return;
        }
        onToggle(col);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>): void {
        if (disabled) {
            return;
        }
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(col);
        }
    }

    return (
        <button
            type="button"
            role="columnheader"
            aria-sort={ariaSort}
            aria-disabled={disabled ? true : undefined}
            title={title ?? label}
            disabled={disabled}
            onClick={handleActivate}
            onKeyDown={handleKeyDown}
            className={className}
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "transparent",
                padding: 0,
                margin: 0,
                cursor: disabled ? "not-allowed" : "pointer",
                userSelect: "none",
                font: "inherit",
                ...style,
            }}
            data-col={String(col)}
        >
            <span>{label}</span>
            {isActive ? (
                <span aria-hidden="true">{dir === "asc" ? "▲" : "▼"}</span>
            ) : (
                <span aria-hidden="true" style={{ opacity: 0 }}>
                    ▲
                </span>
            )}
        </button>
    );
}
