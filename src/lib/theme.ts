// src/lib/theme.ts
import * as React from "react";

type LegacyMQL = {
    addListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
    removeListener?: (listener: (ev?: MediaQueryListEvent) => void) => void;
};

export function usePrefersDark(): boolean {
    function getInitial(): boolean {
        if (typeof window === "undefined") {
            return false;
        } else {
            return window.matchMedia("(prefers-color-scheme: dark)").matches;
        }
    }

    const [isDark, setIsDark] = React.useState<boolean>(getInitial);

    React.useEffect(() => {
        if (typeof window === "undefined") {
            return;
        } else {
            const mq = window.matchMedia("(prefers-color-scheme: dark)");

            // Modern handler (receives an event)
            const onChangeModern = (e: MediaQueryListEvent): void => {
                setIsDark(e.matches);
            };
            // Legacy handler (older Safari may not pass an event)
            const onChangeLegacy = (): void => {
                setIsDark(mq.matches);
            };

            let cleanup: () => void;

            // Modern path
            if (typeof (mq as MediaQueryList).addEventListener === "function" && typeof (mq as MediaQueryList).removeEventListener === "function") {
                mq.addEventListener("change", onChangeModern);
                cleanup = () => {
                    mq.removeEventListener("change", onChangeModern);
                };
            }
            // Legacy path (retype to a shape that *may* have addListener/removeListener)
            else {
                const legacy = mq as MediaQueryList & LegacyMQL;
                if (typeof legacy.addListener === "function" && typeof legacy.removeListener === "function") {
                    legacy.addListener(onChangeLegacy);
                    cleanup = () => {
                        legacy.removeListener!(onChangeLegacy);
                    };
                } else {
                    cleanup = () => { };
                }
            }

            // Sync once after mount/hydration
            setIsDark(mq.matches);

            return cleanup;
        }
    }, []);

    return isDark;
}

export function themeTokens(isDark: boolean): {
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
} {
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
    } else {
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
