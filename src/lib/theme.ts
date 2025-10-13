import * as React from "react";

export type ThemeTokens = {
    bgCard: string;
    fgCard: string;
    border: string;
    headerBg: string;
    headerFg: string;
    rowEven: string;
    rowOdd: string;
    rowFg: string;
    fieldBg: string;
    fieldFg: string;
};

type LegacyMQL = {
    addListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
};

export function usePrefersDark(): boolean {
    function getInitial(): boolean {
        if (typeof window === "undefined") { return false; }
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    const [isDark, setIsDark] = React.useState<boolean>(getInitial);

    React.useEffect(() => {
        if (typeof window === "undefined") { return; }

        const mq = window.matchMedia("(prefers-color-scheme: dark)");

        const onChangeModern = (e: MediaQueryListEvent): void => setIsDark(e.matches);
        const onChangeLegacy = (): void => setIsDark(mq.matches);

        let cleanup: () => void;

        if (
            typeof (mq as MediaQueryList).addEventListener === "function" &&
            typeof (mq as MediaQueryList).removeEventListener === "function"
        ) {
            mq.addEventListener("change", onChangeModern);
            cleanup = () => mq.removeEventListener("change", onChangeModern);
        } else {
            const legacy = mq as MediaQueryList & LegacyMQL;
            if (typeof legacy.addListener === "function" && typeof legacy.removeListener === "function") {
                legacy.addListener(onChangeLegacy);
                cleanup = () => legacy.removeListener!(onChangeLegacy);
            } else {
                cleanup = () => { };
            }
        }

        setIsDark(mq.matches);
        return cleanup;
    }, []);

    return isDark;
}

export function themeTokens(isDark: boolean): ThemeTokens {
    if (isDark) {
        return {
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
        };
    }
    return {
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
    };
}

export function fieldStyle(isDark: boolean): React.CSSProperties {
    return {
        width: "100%",
        padding: "8px 10px",
        borderRadius: 6,
        font: "inherit",
        background: isDark ? "#141414" : "#fdfdfd",
        color: isDark ? "#f1f1f1" : "#111",
        border: `1px solid ${isDark ? "#2a2a2a" : "#ccc"}`,
    };
}
