// src/lib/theme.ts
import * as React from "react";

/**
 * Centralized theme tokens used across the app.
 * Short aliases (bg/fg/panelBg) are included for ergonomic usage in pages.
 */
export type ThemeTokens = {
    /** Alias: page background color */
    bg: string;
    /** Alias: primary text color */
    fg: string;
    /** Alias: panel/card background */
    panelBg: string;

    /** Card/panel background (canonical) */
    bgCard: string;
    /** Card/panel foreground (canonical) */
    fgCard: string;
    /** Generic border color */
    border: string;

    /** Table/header styling */
    headerBg: string;
    headerFg: string;

    /** Row colors (tables/lists) */
    rowEven: string;
    rowOdd: string;
    rowFg: string;

    /** Input field styling */
    fieldBg: string;
    fieldFg: string;
};

type LegacyMQL = {
    addListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
};

/**
 * Hook: prefers dark mode
 */
export function usePrefersDark(): boolean {
    function getInitial(): boolean {
        if (typeof window === "undefined") { return false; }
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    const [isDark, setIsDark] = React.useState<boolean>(getInitial);

    React.useEffect((): (() => void) | void => {
        if (typeof window === "undefined") { return; }

        const mq = window.matchMedia("(prefers-color-scheme: dark)");

        const onChangeModern = (e: MediaQueryListEvent): void => { setIsDark(e.matches); };
        const onChangeLegacy = (): void => { setIsDark(mq.matches); };

        let cleanup: () => void;

        if (
            typeof (mq as MediaQueryList).addEventListener === "function" &&
            typeof (mq as MediaQueryList).removeEventListener === "function"
        ) {
            mq.addEventListener("change", onChangeModern);
            cleanup = (): void => { mq.removeEventListener("change", onChangeModern); };
        } else {
            const legacy = mq as MediaQueryList & LegacyMQL;
            if (typeof legacy.addListener === "function" && typeof legacy.removeListener === "function") {
                legacy.addListener(onChangeLegacy);
                cleanup = (): void => { legacy.removeListener!(onChangeLegacy); };
            } else {
                cleanup = (): void => { /* no-op */ };
            }
        }

        // initialize after mounting
        setIsDark(mq.matches);
        return cleanup;
    }, []);

    return isDark;
}

/**
 * Theme token factory
 */
export function themeTokens(isDark: boolean): ThemeTokens {
    if (isDark) {
        const tokens = {
            // Aliases
            bg: "#0b0b0b",       // page background
            fg: "#e6e6e6",       // primary text
            panelBg: "#0b0b0b",  // panel/card background

            // Canonical tokens
            bgCard: "#0b0b0b",
            fgCard: "#e6e6e6",
            border: "#2a2a2a",

            headerBg: "#1b1b1b",
            headerFg: "#ffffff",

            rowEven: "#0e0e0e",
            rowOdd: "#141414",
            rowFg: "#e6e6e6",

            fieldBg: "#141414",
            fieldFg: "#f1f1f1",
        } satisfies ThemeTokens;
        return tokens;
    }

    const tokens = {
        // Aliases
        bg: "#ffffff",       // page background
        fg: "#000000",       // primary text
        panelBg: "#ffffff",  // panel/card background

        // Canonical tokens
        bgCard: "#ffffff",
        fgCard: "#000000",
        border: "#dddddd",

        headerBg: "#f5f5f5",
        headerFg: "#111111",

        rowEven: "#ffffff",
        rowOdd: "#fafafa",
        rowFg: "#111111",

        fieldBg: "#fdfdfd",
        fieldFg: "#111111",
    } satisfies ThemeTokens;
    return tokens;
}

/**
 * Inline style helper for input fields
 */
export function fieldStyle(isDark: boolean): React.CSSProperties {
    return {
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        font: "inherit",
        background: isDark ? "#141414" : "#fdfdfd",
        color: isDark ? "#f1f1f1" : "#111111",
        border: `1px solid ${isDark ? "#2a2a2a" : "#cccccc"}`,
    };
}
